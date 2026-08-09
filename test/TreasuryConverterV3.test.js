const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintInitialSupply } = require("./helpers/supply");
const { deployOnSide, lt } = require("./helpers/ordering");

// Covers only what V3 changed: the sell leg's oracle and swap path. Everything else —
// the generic buy executor, oracle floors, spend windows, migration — is carried over
// from V2 unchanged and is covered by TreasuryConverterV2.test.js.

const WAD = 10n ** 18n;
const SUPPLY = 1_000_000_000n * WAD;
const FEE = 2500;
const SLIPPAGE_BPS = 500n; // 500 ticks ≈ 5%
const TWAP_TICK = -179_000;

async function deployFixture({ rsvdIsToken0 = true } = {}) {
  // Fund the pool from a signer nothing else touches: Hardhat state persists across
  // test files, so draining signers[0] here breaks unrelated suites later.
  const [owner, keeper, alice, , , , , , , funder] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", owner.address, owner.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  await mintInitialSupply(token, owner.address, SUPPLY);

  // Token ordering decides which way a sale pushes the tick, so pick a WBNB address on
  // the required side of the token rather than hoping.
  const WBNBFactory = await ethers.getContractFactory("MockWBNB");
  const wbnb = await deployOnSide(WBNBFactory, owner, tokenAddress, rsvdIsToken0);
  const wbnbAddress = await wbnb.getAddress();
  expect(lt(tokenAddress, wbnbAddress), "could not place WBNB on the required side").to.equal(rsvdIsToken0);

  const Factory = await ethers.getContractFactory("MockUniswapV3Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const Router = await ethers.getContractFactory("MockSwapRouter");
  const router = await Router.deploy(await factory.getAddress());
  await router.waitForDeployment();
  await router.setWETH9(wbnbAddress);

  const [t0, t1] = rsvdIsToken0 ? [tokenAddress, wbnbAddress] : [wbnbAddress, tokenAddress];
  const Pool = await ethers.getContractFactory("MockUniswapV3Pool");
  const pool = await Pool.deploy(t0, t1, FEE, 50);
  await pool.waitForDeployment();
  await pool.initialize(1n, TWAP_TICK);
  await pool.setTwapTick(TWAP_TICK);
  await factory.setPool(tokenAddress, wbnbAddress, FEE, await pool.getAddress());

  // The pool pays the WBNB leg out of its own inventory.
  await wbnb.connect(funder).deposit({ value: ethers.parseEther("50") });
  await wbnb.connect(funder).transfer(await pool.getAddress(), ethers.parseEther("50"));

  const Vault = await ethers.getContractFactory("ReservedVault");
  const vault = await Vault.deploy(tokenAddress, owner.address, keeper.address);
  await vault.waitForDeployment();

  const Converter = await ethers.getContractFactory("TreasuryConverterV3");
  const converter = await Converter.deploy(
    tokenAddress,
    await vault.getAddress(),
    await router.getAddress(),
    await pool.getAddress(),
    FEE,
    owner.address,
    keeper.address
  );
  await converter.waitForDeployment();
  await converter.setMaxSlippageBps(SLIPPAGE_BPS);

  // Treasury exemption is what lets a V3 swap work at all — see SellerNotTaxExempt.
  await token.setTreasury(await converter.getAddress());
  await token.transfer(await converter.getAddress(), 10_000_000n * WAD);
  await token.setAmmPair(await pool.getAddress(), true);

  return { owner, keeper, alice, token, tokenAddress, wbnb, wbnbAddress, factory, router, pool, vault, converter };
}

describe("TreasuryConverterV3 — V3 sell leg", function () {
  describe("pool wiring", function () {
    it("derives rsvdIsToken0 from the pool rather than accepting it", async function () {
      const a = await deployFixture({ rsvdIsToken0: true });
      expect(await a.converter.rsvdIsToken0()).to.equal(true);

      const b = await deployFixture({ rsvdIsToken0: false });
      expect(await b.converter.rsvdIsToken0()).to.equal(false);
    });

    it("refuses a pool that is not the RSVD/WBNB pair", async function () {
      const ctx = await deployFixture();
      const Other = await ethers.getContractFactory("MockERC20");
      const other = await Other.deploy("Other", "OTH");
      await other.waitForDeployment();

      const Pool = await ethers.getContractFactory("MockUniswapV3Pool");
      const wrong = await Pool.deploy(await other.getAddress(), ctx.wbnbAddress, FEE, 50);
      await wrong.waitForDeployment();

      await expect(
        ctx.converter.setRsvdBnbPool(await wrong.getAddress(), FEE)
      ).to.be.revertedWithCustomError(ctx.converter, "ZeroAddress");
    });
  });

  describe("TWAP", function () {
    it("reads the arithmetic-mean tick from the pool's observation ring", async function () {
      const ctx = await deployFixture();
      expect(await ctx.converter.twapTick()).to.equal(TWAP_TICK);

      await ctx.pool.setTwapTick(-178_000);
      expect(await ctx.converter.twapTick()).to.equal(-178_000);
    });

    it("reverts when the pool cannot serve the window yet", async function () {
      const ctx = await deployFixture();
      // A freshly created pool holds one observation and reverts with OLD.
      await ctx.pool.setObserveReverts(true);
      await expect(ctx.converter.twapTick()).to.be.revertedWithCustomError(ctx.converter, "TwapUnavailable");
    });

    it("needs no checkpoint written by us, unlike the V2 accumulator", async function () {
      const ctx = await deployFixture();
      // No poke call of any kind has been made, yet the TWAP is already available.
      expect(await ctx.converter.twapTick()).to.equal(TWAP_TICK);
      expect(ctx.converter.updateTwapCheckpoint).to.equal(undefined);
    });

    it("forwards a cardinality increase to the pool", async function () {
      const ctx = await deployFixture();
      await ctx.converter.increaseObservationCardinality(200);
      expect(await ctx.pool.observationCardinalityNext()).to.equal(200);
    });
  });

  describe("sellRsvd", function () {
    const AMOUNT = 100_000n * WAD;

    it("sells when the resulting tick stays inside the floor", async function () {
      const ctx = await deployFixture();
      await ctx.router.setRate(WAD / 10_000n);
      await ctx.router.setTickAfterSwap(TWAP_TICK - 100); // 100 ticks ≈ 1%, inside 500

      await expect(ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, 0)).to.emit(ctx.converter, "RsvdSold");
      expect(await ethers.provider.getBalance(await ctx.converter.getAddress())).to.be.greaterThan(0n);
    });

    it("rejects a sale that pushes the tick past the floor", async function () {
      const ctx = await deployFixture();
      await ctx.router.setRate(WAD / 10_000n);
      await ctx.router.setTickAfterSwap(TWAP_TICK - 900); // beyond 500

      await expect(
        ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, 0)
      ).to.be.revertedWithCustomError(ctx.converter, "BeyondTwapFloor");
    });

    it("flips the comparison when RSVD is token1, where a sale pushes the tick up", async function () {
      const ctx = await deployFixture({ rsvdIsToken0: false });
      await ctx.router.setRate(WAD / 10_000n);

      // Same distance, opposite direction: inside the bound going up.
      await ctx.router.setTickAfterSwap(TWAP_TICK + 100);
      await expect(ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, 0)).to.emit(ctx.converter, "RsvdSold");

      // And beyond it going up must still fail — a fixed downward-only check would
      // have let this through.
      await ctx.router.setTickAfterSwap(TWAP_TICK + 900);
      await expect(
        ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, 0)
      ).to.be.revertedWithCustomError(ctx.converter, "BeyondTwapFloor");
    });

    it("still honours a keeper minOut that is stricter than the tick bound", async function () {
      const ctx = await deployFixture();
      await ctx.router.setRate(WAD / 10_000n);
      await ctx.router.setTickAfterSwap(TWAP_TICK - 100);

      await expect(
        ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, ethers.parseEther("1000"))
      ).to.be.reverted;
    });

    it("refuses to sell if the converter is not tax exempt", async function () {
      const ctx = await deployFixture();
      await ctx.router.setRate(WAD / 10_000n);
      await ctx.router.setTickAfterSwap(TWAP_TICK - 100);
      await ctx.token.setTaxExempt(await ctx.converter.getAddress(), false);

      await expect(
        ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, 0)
      ).to.be.revertedWithCustomError(ctx.converter, "SellerNotTaxExempt");
    });

    it("is keeper or owner only", async function () {
      const ctx = await deployFixture();
      await ctx.router.setRate(WAD / 10_000n);
      await ctx.router.setTickAfterSwap(TWAP_TICK - 100);

      await expect(
        ctx.converter.connect(ctx.alice).sellRsvd(AMOUNT, 0)
      ).to.be.revertedWithCustomError(ctx.converter, "NotKeeper");
    });

    it("enforces the per-transaction RSVD cap", async function () {
      const ctx = await deployFixture();
      await ctx.converter.setMaxRsvdSpendPerTx(1000n * WAD);
      await ctx.router.setRate(WAD / 10_000n);
      await ctx.router.setTickAfterSwap(TWAP_TICK - 100);

      await expect(
        ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, 0)
      ).to.be.revertedWithCustomError(ctx.converter, "ExceedsMaxSpend");
    });

    it("delivers native BNB, not WBNB, so the buy leg spends what it did under V2", async function () {
      const ctx = await deployFixture();
      await ctx.router.setRate(WAD / 10_000n);
      await ctx.router.setTickAfterSwap(TWAP_TICK - 100);

      await ctx.converter.connect(ctx.keeper).sellRsvd(AMOUNT, 0);

      const converterAddress = await ctx.converter.getAddress();
      expect(await ethers.provider.getBalance(converterAddress)).to.equal(ethers.parseEther("10"));
      expect(await ctx.wbnb.balanceOf(converterAddress)).to.equal(0n);
    });
  });
});
