const { expect } = require("chai");
const { ethers } = require("hardhat");

// Exercises UniswapV3TokenInitializer.init end to end against mocked V3 contracts.
// The point of interest is the price math: given a target market cap in USD and a
// reference native/stablecoin pool, does init initialise the token pool at a price that
// implies that market cap? A V3 pool is initialised exactly once, so a mistake here is
// permanent, and none of it is checked anywhere else.

const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;

const SUPPLY = 1_000_000_000n * WAD; // 1B RSVD
const BNB_USD = 600n; // reference: 1 BNB = $600
const START_MCAP = 100_000n * WAD; // $100k
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

/// price is token1-per-token0, scaled by 1e18.
function encodeSqrtPriceX96(priceWad) {
  return bigintSqrt((priceWad * Q96 * Q96) / WAD);
}

/// inverse of the above — returns token1-per-token0 scaled by 1e18.
function decodePriceWad(sqrtPriceX96) {
  return (sqrtPriceX96 * sqrtPriceX96 * WAD) / (Q96 * Q96);
}

const lt = (a, b) => BigInt(a) < BigInt(b);

/// Relative difference in basis points, for tolerance assertions.
function driftBps(actual, expected) {
  const diff = actual > expected ? actual - expected : expected - actual;
  return Number((diff * 10_000n) / expected);
}

async function deployFixture({ wbnbBelowToken = null } = {}) {
  const [owner, treasury, alice, bob] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", owner.address, treasury.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  // Token ordering drives every branch in _getTicks and the price inversions, so tests
  // that care about it deploy WBNB candidates until one lands on the required side.
  const WBNBFactory = await ethers.getContractFactory("MockWBNB");
  let wbnb = await WBNBFactory.deploy();
  await wbnb.waitForDeployment();
  if (wbnbBelowToken !== null) {
    for (let i = 0; i < 40 && lt(await wbnb.getAddress(), tokenAddress) !== wbnbBelowToken; i++) {
      wbnb = await WBNBFactory.deploy();
      await wbnb.waitForDeployment();
    }
    expect(
      lt(await wbnb.getAddress(), tokenAddress),
      "could not find a WBNB address on the required side of the token"
    ).to.equal(wbnbBelowToken);
  }
  const wbnbAddress = await wbnb.getAddress();

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

  const Router = await ethers.getContractFactory("MockSwapRouter");
  const router = await Router.deploy(await factory.getAddress());
  await router.waitForDeployment();

  const Initializer = await ethers.getContractFactory("UniswapV3TokenInitializer");
  const initializer = await Initializer.deploy();
  await initializer.waitForDeployment();

  return {
    owner, treasury, alice, bob,
    token, tokenAddress,
    wbnb, wbnbAddress,
    usdt, usdtAddress,
    factory, positionManager, router, initializer,
  };
}

/// Stands up the native/stablecoin pool that _getInitialSqrtPriceX96 prices against.
async function seedReferencePool(ctx, { poolKind = "MockUniswapV3Pool", feeProtocol = 0 } = {}) {
  const { wbnbAddress, usdtAddress, factory } = ctx;
  const wbnbIsToken0 = lt(wbnbAddress, usdtAddress);
  const [token0, token1] = wbnbIsToken0 ? [wbnbAddress, usdtAddress] : [usdtAddress, wbnbAddress];

  // token1-per-token0: USDT per WBNB if WBNB sorts first, otherwise WBNB per USDT.
  const priceWad = wbnbIsToken0 ? BNB_USD * WAD : WAD / BNB_USD;
  const sqrtPriceX96 = encodeSqrtPriceX96(priceWad);

  const PoolFactory = await ethers.getContractFactory(poolKind);
  const pool =
    poolKind === "MockPancakeV3Pool"
      ? await PoolFactory.deploy(token0, token1, FEE, 50, feeProtocol)
      : await PoolFactory.deploy(token0, token1, FEE, 50);
  await pool.waitForDeployment();
  await pool.initialize(sqrtPriceX96, 0);
  await factory.setPool(wbnbAddress, usdtAddress, FEE, await pool.getAddress());
  return pool;
}

function buildPayload(ctx, overrides = {}) {
  const args = {
    initialSupply: SUPPLY,
    ownerSupply: 0n,
    fee: FEE,
    walletKey: 0n,
    wallets: [],
    startMarketcap: START_MCAP,
    ...overrides,
  };
  return ctx.initializer.interface.encodeFunctionData("init", [
    ctx.positionManager.target,
    ctx.router.target,
    ctx.usdtAddress,
    args.initialSupply,
    args.ownerSupply,
    args.fee,
    args.walletKey,
    args.wallets,
    args.startMarketcap,
  ]);
}

const mask = (addr, key) => BigInt(addr) + key;

/// Recovers the implied USD market cap from the sqrtPriceX96 init handed to the pool.
function impliedMarketCapUsd(ctx, sqrtPriceX96, supply = SUPPLY) {
  const wbnbIsToken0 = lt(ctx.wbnbAddress, ctx.tokenAddress);
  const priceWad = decodePriceWad(sqrtPriceX96); // token1 per token0, 1e18
  // Want RSVD priced in BNB.
  const tokenPriceInBnbWad = wbnbIsToken0
    ? (WAD * WAD) / priceWad // priceWad is RSVD per BNB
    : priceWad; // priceWad is already BNB per RSVD
  // tokenPriceInBnbWad and supply are both 1e18-scaled, so one WAD divide leaves the
  // result 1e18-scaled to match START_MCAP.
  return (tokenPriceInBnbWad * BNB_USD * supply) / WAD;
}

describe("UniswapV3TokenInitializer.init", function () {
  describe("price math", function () {
    for (const wbnbBelowToken of [true, false]) {
      const ordering = wbnbBelowToken ? "WBNB is token0" : "RSVD is token0";

      it(`initialises the pool at the requested market cap (${ordering})`, async function () {
        const ctx = await deployFixture({ wbnbBelowToken });
        await seedReferencePool(ctx);

        await ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx));

        const sqrtPriceX96 = await ctx.positionManager.lastSqrtPriceX96();
        expect(sqrtPriceX96).to.be.greaterThan(0n);

        const impliedUsd = impliedMarketCapUsd(ctx, sqrtPriceX96);
        // Tolerance covers the initializer's integer Babylonian sqrt.
        expect(
          driftBps(impliedUsd, START_MCAP),
          `implied $${ethers.formatUnits(impliedUsd, 18)} vs requested $${ethers.formatUnits(START_MCAP, 18)}`
        ).to.be.lessThan(10);
      });
    }

    it("scales linearly with the requested market cap", async function () {
      const ctx = await deployFixture({ wbnbBelowToken: false });
      await seedReferencePool(ctx);

      await ctx.token.postDeploy(
        ctx.initializer.target,
        buildPayload(ctx, { startMarketcap: 250_000n * WAD })
      );

      const implied = impliedMarketCapUsd(ctx, await ctx.positionManager.lastSqrtPriceX96());
      expect(driftBps(implied, 250_000n * WAD)).to.be.lessThan(10);
    });

    it("reverts when the reference native/stablecoin pool does not exist at that fee tier", async function () {
      const ctx = await deployFixture();
      // No seedReferencePool — getPool returns address(0), slot0() has nothing to decode.
      await expect(ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx))).to.be.reverted;
    });
  });

  describe("supply and liquidity", function () {
    it("mints the full supply and routes it into the pool position", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);

      await ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx));

      expect(await ctx.token.totalSupply()).to.equal(SUPPLY);
      const pool = await ctx.positionManager.lastPool();
      // V3 leaves a few wei unconsumed by the position; init sweeps that remainder to
      // the owner at the end.
      const dust = await ctx.positionManager.mintShortfallWei();
      expect(await ctx.token.balanceOf(pool)).to.equal(SUPPLY - dust);
      expect(await ctx.token.balanceOf(ctx.owner.address)).to.equal(dust);
      expect(await ctx.token.balanceOf(ctx.tokenAddress)).to.equal(0n);
      expect(await ctx.positionManager.mintCallCount()).to.equal(1n);
    });

    it("holds back ownerSupply for the owner and pools the rest", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      const ownerSupply = 100_000_000n * WAD; // 10%

      await ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx, { ownerSupply }));

      const dust = await ctx.positionManager.mintShortfallWei();
      expect(await ctx.token.balanceOf(ctx.owner.address)).to.equal(ownerSupply + dust);
      expect(await ctx.token.balanceOf(await ctx.positionManager.lastPool())).to.equal(
        SUPPLY - ownerSupply - dust
      );
      expect(await ctx.token.totalSupply()).to.equal(SUPPLY);
    });

    it("prices the market cap off full supply, not just the pooled portion", async function () {
      const ctx = await deployFixture({ wbnbBelowToken: false });
      await seedReferencePool(ctx);

      await ctx.token.postDeploy(
        ctx.initializer.target,
        buildPayload(ctx, { ownerSupply: 500_000_000n * WAD })
      );

      const implied = impliedMarketCapUsd(ctx, await ctx.positionManager.lastSqrtPriceX96());
      expect(driftBps(implied, START_MCAP)).to.be.lessThan(10);
    });

    it("registers the pool as an AMM pair and drops its tax exemption", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);

      await ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx));

      const pool = await ctx.positionManager.lastPool();
      expect(await ctx.token.isAmmPair(pool)).to.equal(true);
      expect(await ctx.token.isTaxExempt(pool)).to.equal(false);
    });

    it("opens a single-sided position — only the token leg is funded", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);

      await ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx));

      const a0 = await ctx.positionManager.lastAmount0Desired();
      const a1 = await ctx.positionManager.lastAmount1Desired();
      expect(a0 === 0n || a1 === 0n, "one leg must be unfunded").to.equal(true);
      expect(a0 + a1).to.equal(SUPPLY);
    });

    // Regression: the mint bound used to be `amountMin == amountDesired`, demanding the
    // pool consume the supply to the wei. V3 rounds liquidity down and always lands a
    // little short, so every launch reverted with "Price slippage check" — which is
    // exactly what BSC mainnet returned before this was loosened to 1bp.
    it("survives the wei-level shortfall V3 leaves on every mint", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      await ctx.positionManager.setMintShortfallWei(5000);

      await expect(ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx))).to.not.be.reverted;
    });

    it("still rejects a range that would consume only part of the supply", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      // A range straddling the current tick needs the other token, which this contract
      // does not hold — the position would take a fraction and the rest would be swept
      // to the owner. The 1bp bound has to keep failing that loudly.
      await ctx.positionManager.setMintFillBps(5_000);

      await expect(ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx))).to.be.revertedWith(
        "Price slippage check"
      );
    });

    // Documents accepted behaviour: see the launch checklist.
    it("KNOWN RISK: sends the LP position to the owner, leaving liquidity unlocked", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);

      await ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx));

      expect(await ctx.positionManager.lastRecipient()).to.equal(ctx.owner.address);
    });
  });

  describe("first buy", function () {
    const BUY = ethers.parseEther("1");

    it("splits the bought tokens across the supplied wallets", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      await ctx.router.setRate(1_000_000n * WAD / WAD * WAD); // 1 WBNB -> 1,000,000 RSVD

      const key = 12345678901234567890n;
      const wallets = [ctx.alice.address, ctx.bob.address];

      await ctx.token.postDeploy(
        ctx.initializer.target,
        buildPayload(ctx, { walletKey: key, wallets: wallets.map((w) => mask(w, key)) }),
        { value: BUY }
      );

      const aliceBalance = await ctx.token.balanceOf(ctx.alice.address);
      const bobBalance = await ctx.token.balanceOf(ctx.bob.address);
      const bought = await ctx.router.lastAmountOut();

      expect(aliceBalance).to.be.greaterThan(0n);
      expect(bobBalance).to.be.greaterThan(0n);
      // Nothing is lost or created in the split. The LP remainder is swept into the buy
      // recipient before the split runs, so it is distributed along with the purchase.
      const dust = await ctx.positionManager.mintShortfallWei();
      expect(aliceBalance + bobBalance).to.equal(bought + dust);
    });

    it("recovers the wallet addresses from the masked values", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      await ctx.router.setRate(WAD);

      const key = 999_999_999n;
      await ctx.token.postDeploy(
        ctx.initializer.target,
        buildPayload(ctx, { walletKey: key, wallets: [mask(ctx.alice.address, key)] }),
        { value: BUY }
      );

      // The entire buy, plus the swept LP remainder, lands on the single unmasked wallet.
      const dust = await ctx.positionManager.mintShortfallWei();
      expect(await ctx.token.balanceOf(ctx.alice.address)).to.equal(
        (await ctx.router.lastAmountOut()) + dust
      );
    });

    it("reverts when a buy is funded but no wallets are supplied", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      await ctx.router.setRate(WAD);

      await expect(
        ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx), { value: BUY })
      ).to.be.reverted;
    });

    it("takes no tax on the launch buy, but taxes the next one", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      await ctx.router.setRate(1000n * WAD);

      const key = 1n;
      await ctx.token.postDeploy(
        ctx.initializer.target,
        buildPayload(ctx, { walletKey: key, wallets: [mask(ctx.alice.address, key)] }),
        { value: BUY }
      );

      // Untaxed: the wallet received the router's full payout, with nothing skimmed.
      const dust = await ctx.positionManager.mintShortfallWei();
      expect(await ctx.token.balanceOf(ctx.alice.address)).to.equal(
        (await ctx.router.lastAmountOut()) + dust
      );
      expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(0n);

      // The pool is a taxed AMM pair from here on.
      const pool = await ctx.positionManager.lastPool();
      await ctx.token.connect(ctx.alice).transfer(pool, 1000n * WAD);
      expect(await ctx.token.balanceOf(ctx.treasury.address)).to.equal(30n * WAD); // 3%
    });

    it("KNOWN RISK: swaps with no slippage floor", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx);
      await ctx.router.setRate(WAD);

      const key = 7n;
      await ctx.token.postDeploy(
        ctx.initializer.target,
        buildPayload(ctx, { walletKey: key, wallets: [mask(ctx.alice.address, key)] }),
        { value: BUY }
      );

      expect(await ctx.router.lastAmountOutMinimum()).to.equal(0n);
    });
  });

  describe("PancakeSwap V3 compatibility", function () {
    // PancakeSwap's slot0 returns `uint32 feeProtocol`, packing feeProtocol0 |
    // (feeProtocol1 << 16); Uniswap V3 returns `uint8`. Solidity's ABI decoder rejects a
    // word that does not fit the declared type, so declaring uint8 reverted against any
    // Pancake pool carrying a protocol fee. IUniswapV3Pool now declares uint32, which
    // decodes both. These tests hold that open — narrowing it again breaks the launch.
    //
    // Read from BSC mainnet on 2026-08-08: the WBNB/USDT 0.25% pool
    // (0x1401ff943D08a7E098328C1d3a9d388923B115D2) reports feeProtocol 209718400.
    const LIVE_BSC_FEE_PROTOCOL = 209_718_400; // 3200 | (3200 << 16)

    it("decodes slot0 from a Uniswap-shaped pool, whose feeProtocol is a uint8", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx, { poolKind: "MockUniswapV3Pool" });
      await expect(ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx))).to.not.be.reverted;
    });

    it("decodes slot0 from a Pancake-shaped pool with a small feeProtocol", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx, { poolKind: "MockPancakeV3Pool", feeProtocol: 100 });
      await expect(ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx))).to.not.be.reverted;
    });

    it("decodes slot0 at BSC mainnet's live feeProtocol, which overflows a uint8", async function () {
      const ctx = await deployFixture();
      await seedReferencePool(ctx, { poolKind: "MockPancakeV3Pool", feeProtocol: LIVE_BSC_FEE_PROTOCOL });
      await expect(ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx))).to.not.be.reverted;
    });

    it("prices the launch identically whatever feeProtocol the reference pool reports", async function () {
      const priceFor = async (poolKind, feeProtocol) => {
        const ctx = await deployFixture({ wbnbBelowToken: false });
        await seedReferencePool(ctx, { poolKind, feeProtocol });
        await ctx.token.postDeploy(ctx.initializer.target, buildPayload(ctx));
        return ctx.positionManager.lastSqrtPriceX96();
      };

      // feeProtocol is not an input to the price math, so widening its type must not
      // move the launch price.
      expect(await priceFor("MockPancakeV3Pool", LIVE_BSC_FEE_PROTOCOL)).to.equal(
        await priceFor("MockUniswapV3Pool", 0)
      );
    });
  });
});
