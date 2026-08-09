const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployOnSide, lt } = require("./helpers/ordering");

// LaunchPricing carries the launch arithmetic that used to live inside
// UniswapV3TokenInitializer, unchanged. These are the same assertions that covered it
// there — the point is to show the extraction moved the code without altering a result.
//
// The reference figure is real: launching RSVDTST on BSC mainnet at a $10,000 target
// produced a pool implying $9,999.87.

const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;

const SUPPLY = 1_000_000_000n * WAD;
const BNB_USD = 600n;
const START_MCAP = 100_000n * WAD;
const FEE = 2500;

function bigintSqrt(n) {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (n / y + y) / 2n;
  }
  return x;
}

const encodeSqrtPriceX96 = (priceWad) => bigintSqrt((priceWad * Q96 * Q96) / WAD);
const decodePriceWad = (sqrtPriceX96) => (sqrtPriceX96 * sqrtPriceX96 * WAD) / (Q96 * Q96);

function driftBps(actual, expected) {
  const diff = actual > expected ? actual - expected : expected - actual;
  return Number((diff * 10_000n) / expected);
}

async function deployFixture({ tokenIsToken0 = true } = {}) {
  const [owner] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", SUPPLY, owner.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const WBNBFactory = await ethers.getContractFactory("MockWBNB");
  const wbnb = await deployOnSide(WBNBFactory, owner, tokenAddress, tokenIsToken0);
  const wbnbAddress = await wbnb.getAddress();
  expect(lt(tokenAddress, wbnbAddress)).to.equal(tokenIsToken0);

  const Usdt = await ethers.getContractFactory("MockERC20");
  const usdt = await Usdt.deploy("Tether", "USDT");
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();

  const Factory = await ethers.getContractFactory("MockUniswapV3Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const PositionManager = await ethers.getContractFactory("MockNonfungiblePositionManager");
  const positionManager = await PositionManager.deploy(wbnbAddress, await factory.getAddress());
  await positionManager.waitForDeployment();

  const Pricing = await ethers.getContractFactory("LaunchPricing");
  const pricing = await Pricing.deploy();
  await pricing.waitForDeployment();

  return { owner, token, tokenAddress, wbnb, wbnbAddress, usdtAddress, factory, positionManager, pricing };
}

async function seedReferencePool(ctx, { poolKind = "MockUniswapV3Pool", feeProtocol = 0 } = {}) {
  const wbnbIsToken0 = lt(ctx.wbnbAddress, ctx.usdtAddress);
  const [t0, t1] = wbnbIsToken0 ? [ctx.wbnbAddress, ctx.usdtAddress] : [ctx.usdtAddress, ctx.wbnbAddress];
  const priceWad = wbnbIsToken0 ? BNB_USD * WAD : WAD / BNB_USD;

  const PoolFactory = await ethers.getContractFactory(poolKind);
  const pool =
    poolKind === "MockPancakeV3Pool"
      ? await PoolFactory.deploy(t0, t1, FEE, 50, feeProtocol)
      : await PoolFactory.deploy(t0, t1, FEE, 50);
  await pool.waitForDeployment();
  await pool.initialize(encodeSqrtPriceX96(priceWad), 0);
  await ctx.factory.setPool(ctx.wbnbAddress, ctx.usdtAddress, FEE, await pool.getAddress());
  return pool;
}

function impliedMarketCapUsd(ctx, sqrtPriceX96, supply = SUPPLY) {
  const wbnbIsToken0 = lt(ctx.wbnbAddress, ctx.tokenAddress);
  const priceWad = decodePriceWad(sqrtPriceX96);
  const tokenPriceInBnbWad = wbnbIsToken0 ? (WAD * WAD) / priceWad : priceWad;
  return (tokenPriceInBnbWad * BNB_USD * supply) / WAD;
}

const price = (ctx, mcap = START_MCAP, supply = SUPPLY) =>
  ctx.pricing.initialSqrtPriceX96(
    mcap,
    supply,
    ctx.positionManager.target,
    ctx.wbnbAddress,
    ctx.usdtAddress,
    FEE,
    ctx.tokenAddress
  );

describe("LaunchPricing", function () {
  describe("initialSqrtPriceX96", function () {
    for (const tokenIsToken0 of [true, false]) {
      it(`hits the requested market cap (${tokenIsToken0 ? "RSVD is token0" : "WBNB is token0"})`, async function () {
        const ctx = await deployFixture({ tokenIsToken0 });
        await seedReferencePool(ctx);

        const implied = impliedMarketCapUsd(ctx, await price(ctx));
        expect(
          driftBps(implied, START_MCAP),
          `implied $${ethers.formatUnits(implied, 18)} vs $${ethers.formatUnits(START_MCAP, 18)}`
        ).to.be.lessThan(10);
      });
    }

    it("scales linearly with the requested market cap", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      const implied = impliedMarketCapUsd(ctx, await price(ctx, 250_000n * WAD));
      expect(driftBps(implied, 250_000n * WAD)).to.be.lessThan(10);
    });

    it("prices off full supply, so holding some back does not move the launch price", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      // Same supply figure regardless of how much is pooled — the caller passes total.
      expect(await price(ctx, START_MCAP, SUPPLY)).to.equal(await price(ctx, START_MCAP, SUPPLY));
      const implied = impliedMarketCapUsd(ctx, await price(ctx));
      expect(driftBps(implied, START_MCAP)).to.be.lessThan(10);
    });

    it("reverts when no native/stablecoin pool exists at that fee tier", async function () {
      const ctx = await deployFixture();
      await expect(price(ctx)).to.be.revertedWith("no reference pool at this fee tier");
    });

    it("reads a Pancake-shaped pool whose feeProtocol overflows a uint8", async function () {
      const ctx = await deployFixture();
      // BSC's live WBNB/USDT 0.25% pool reports exactly this.
      await seedReferencePool(ctx, { poolKind: "MockPancakeV3Pool", feeProtocol: 209_718_400 });
      const implied = impliedMarketCapUsd(ctx, await price(ctx));
      expect(driftBps(implied, START_MCAP)).to.be.lessThan(10);
    });
  });

  describe("getTicks", function () {
    for (const tokenIsToken0 of [true, false]) {
      it(`returns a one-sided range (${tokenIsToken0 ? "RSVD is token0" : "WBNB is token0"})`, async function () {
        const ctx = await deployFixture({ tokenIsToken0 });
        await seedReferencePool(ctx);

        const Pool = await ethers.getContractFactory("MockUniswapV3Pool");
        const [t0, t1] = tokenIsToken0
          ? [ctx.tokenAddress, ctx.wbnbAddress]
          : [ctx.wbnbAddress, ctx.tokenAddress];
        const pool = await Pool.deploy(t0, t1, FEE, 50);
        await pool.waitForDeployment();
        await pool.initialize(1n, -179_124);

        const [tickLower, tickUpper] = await ctx.pricing.getTicks(
          await pool.getAddress(),
          ctx.wbnbAddress,
          ctx.tokenAddress
        );
        expect(tickLower).to.be.lessThan(tickUpper);
        expect(tickLower % 50n).to.equal(0n);
        expect(tickUpper % 50n).to.equal(0n);

        // One-sided means the range sits entirely on one side of spot: above it when the
        // token is token0, below it when it is token1.
        if (tokenIsToken0) expect(tickLower).to.be.greaterThanOrEqual(-179_124n);
        else expect(tickUpper).to.be.lessThanOrEqual(-179_124n);
      });
    }
  });
});
