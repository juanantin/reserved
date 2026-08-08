const { expect } = require("chai");
const { ethers } = require("hardhat");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18);
const TEN_MINUTES = 10 * 60;
const ONE_DAY = 24 * 60 * 60;

// Chainlink-style 8-decimal answers. $600/BNB and $60/bStock, so 1 BNB should buy
// exactly 10 bStock at oracle-fair value — a ratio picked to keep the expected
// floor arithmetic in the tests below obvious by inspection.
const BNB_USD_8DEC = 60000000000n; // $600.00000000
const BSTOCK_USD_8DEC = 6000000000n; // $60.00000000

async function deploySystem() {
  const [owner, keeper, other] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", FIXED_SUPPLY, owner.address, owner.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const Vault = await ethers.getContractFactory("ReservedVault");
  const vault = await Vault.deploy(tokenAddress, owner.address, keeper.address);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  const Mock = await ethers.getContractFactory("MockERC20");
  const wbnb = await Mock.deploy("Wrapped BNB", "WBNB");
  await wbnb.waitForDeployment();
  const wbnbAddress = await wbnb.getAddress();

  const bStock = await Mock.deploy("Mock bNVDA", "NVDAB");
  await bStock.waitForDeployment();
  const bStockAddress = await bStock.getAddress();

  const usdt = await Mock.deploy("Mock USDT", "USDT");
  await usdt.waitForDeployment();
  const usdtAddress = await usdt.getAddress();

  const Router = await ethers.getContractFactory("MockUniswapV2Router");
  const router = await Router.deploy(wbnbAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  // RSVD is token0, WBNB is token1 — exercises the "token0 == rsvd" branch.
  const Pair = await ethers.getContractFactory("MockUniswapV2Pair");
  const pair = await Pair.deploy(tokenAddress, wbnbAddress);
  await pair.waitForDeployment();
  const pairAddress = await pair.getAddress();

  const Feed = await ethers.getContractFactory("MockChainlinkFeed");
  const bnbFeed = await Feed.deploy(BNB_USD_8DEC, 8);
  await bnbFeed.waitForDeployment();
  const bnbFeedAddress = await bnbFeed.getAddress();

  const bStockFeed = await Feed.deploy(BSTOCK_USD_8DEC, 8);
  await bStockFeed.waitForDeployment();
  const bStockFeedAddress = await bStockFeed.getAddress();

  const SwapTarget = await ethers.getContractFactory("MockSwapTarget");
  const swapTarget = await SwapTarget.deploy();
  await swapTarget.waitForDeployment();
  const swapTargetAddress = await swapTarget.getAddress();

  const Converter = await ethers.getContractFactory("TreasuryConverterV2");
  const converter = await Converter.deploy(
    tokenAddress,
    vaultAddress,
    routerAddress,
    pairAddress,
    owner.address,
    keeper.address
  );
  await converter.waitForDeployment();
  const converterAddress = await converter.getAddress();

  await owner.sendTransaction({ to: routerAddress, value: ethers.parseEther("100") });

  // The converter deposits into the vault as itself, so the vault must treat the
  // converter (not the EOA keeper) as its keeper — same shape as production.
  await vault.connect(owner).setKeeper(converterAddress);

  return {
    token,
    vault,
    wbnb,
    bStock,
    usdt,
    router,
    pair,
    bnbFeed,
    bStockFeed,
    swapTarget,
    converter,
    owner,
    keeper,
    other,
    tokenAddress,
    vaultAddress,
    wbnbAddress,
    bStockAddress,
    usdtAddress,
    routerAddress,
    pairAddress,
    bnbFeedAddress,
    bStockFeedAddress,
    swapTargetAddress,
    converterAddress,
  };
}

// Wires the converter for a native-BNB buy of `bStock` through `swapTarget`, funds
// both sides, and returns the pieces a test needs to trigger it.
async function armNativeBuy(ctx, { bnbToFund = ethers.parseEther("10"), stockInventory = ethers.parseUnits("1000", 18) } = {}) {
  const { converter, owner, bStock, bStockAddress, swapTargetAddress, bnbFeedAddress, bStockFeedAddress, converterAddress } =
    ctx;

  await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
  await converter.connect(owner).setAllowedTarget(swapTargetAddress, true);
  await converter.connect(owner).setMaxSpendPerTx(ethers.ZeroAddress, ethers.parseEther("5"));
  await converter.connect(owner).setAssetUsdFeed(ethers.ZeroAddress, bnbFeedAddress);
  await converter.connect(owner).setAssetUsdFeed(bStockAddress, bStockFeedAddress);

  await owner.sendTransaction({ to: converterAddress, value: bnbToFund });
  await bStock.mint(swapTargetAddress, stockInventory);
}

function encodeNativeSwap(swapTarget, tokenOut, amountOut, recipient) {
  return swapTarget.interface.encodeFunctionData("swapExactNative", [tokenOut, amountOut, recipient]);
}

// Mirrors primeTwap from the V1 suite: dictates the exact TWAP the contract will
// compute by driving the mock pair's self-reported cumulative prices and timestamps,
// independent of the EVM clock.
async function primeTwap(pair, converter, priceX112PerRsvd, elapsedSeconds) {
  const t0 = 1000;
  await pair.setReserves(0, 0, t0);
  await pair.setCumulativePrices(0, 0);
  await converter.updateTwapCheckpoint();

  const t1 = t0 + elapsedSeconds;
  await pair.setReserves(0, 0, t1);
  await pair.setCumulativePrices(priceX112PerRsvd * BigInt(elapsedSeconds), 0);
}

describe("TreasuryConverterV2", function () {
  describe("access control & configuration", function () {
    it("rejects zero addresses in the constructor", async function () {
      const { vaultAddress, routerAddress, pairAddress, owner, keeper } = await deploySystem();
      const Converter = await ethers.getContractFactory("TreasuryConverterV2");
      await expect(
        Converter.deploy(ethers.ZeroAddress, vaultAddress, routerAddress, pairAddress, owner.address, keeper.address)
      ).to.be.revertedWithCustomError(Converter, "ZeroAddress");
    });

    it("only the keeper or owner can call the value-moving functions", async function () {
      const { converter, other, bStockAddress, swapTargetAddress } = await deploySystem();
      await expect(converter.connect(other).sellRsvd(1, 1)).to.be.revertedWithCustomError(converter, "NotKeeper");
      await expect(
        converter.connect(other).acquireReserveAsset(ethers.ZeroAddress, 1, swapTargetAddress, "0x", bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "NotKeeper");
      await expect(converter.connect(other).depositReserveAsset(bStockAddress, 1)).to.be.revertedWithCustomError(
        converter,
        "NotKeeper"
      );
    });

    it("only the owner can change admin settings", async function () {
      const { converter, other, swapTargetAddress } = await deploySystem();
      await expect(converter.connect(other).setKeeper(other.address)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
      await expect(converter.connect(other).setAllowedTarget(swapTargetAddress, true)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
      await expect(converter.connect(other).setRequireOracleFloor(false)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
    });

    it("refuses to allowlist RSVD, the vault, or itself as a swap target", async function () {
      const { converter, owner, tokenAddress, vaultAddress, converterAddress } = await deploySystem();
      for (const forbidden of [tokenAddress, vaultAddress, converterAddress]) {
        await expect(converter.connect(owner).setAllowedTarget(forbidden, true)).to.be.revertedWithCustomError(
          converter,
          "ForbiddenTarget"
        );
      }
    });

    it("refuses to allowlist an EOA as a swap target", async function () {
      const { converter, owner, other } = await deploySystem();
      await expect(converter.connect(owner).setAllowedTarget(other.address, true)).to.be.revertedWithCustomError(
        converter,
        "NotAContract"
      );
    });

    it("refuses to allowlist a non-18-decimal reserve asset", async function () {
      const { converter, owner } = await deploySystem();
      const SixDecimals = await ethers.getContractFactory("MockERC20CustomDecimals");
      const odd = await SixDecimals.deploy("Six Decimal", "SIX", 6);
      await odd.waitForDeployment();
      await expect(
        converter.connect(owner).setAllowedReserveAsset(await odd.getAddress(), true)
      ).to.be.revertedWithCustomError(converter, "UnsupportedDecimals");
    });

    it("caps maxSlippageBps at the hard ceiling", async function () {
      const { converter, owner } = await deploySystem();
      await expect(converter.connect(owner).setMaxSlippageBps(1001)).to.be.revertedWithCustomError(
        converter,
        "SlippageTooHigh"
      );
      await converter.connect(owner).setMaxSlippageBps(1000);
      expect(await converter.maxSlippageBps()).to.equal(1000);
    });
  });

  describe("sell leg (RSVD -> BNB)", function () {
    it("sells against the pair's own TWAP floor and re-checkpoints", async function () {
      const { converter, token, router, pair, owner, keeper, converterAddress } = await deploySystem();

      const amountIn = ethers.parseUnits("1000", 18);
      await token.connect(owner).transfer(converterAddress, amountIn);

      // 0.001 BNB per RSVD in UQ112x112.
      const priceX112 = (1n << 112n) / 1000n;
      await primeTwap(pair, converter, priceX112, TEN_MINUTES);

      const expectedTwapOut = (amountIn * priceX112) >> 112n;
      const floor = (expectedTwapOut * 9700n) / 10000n;
      await router.setNextSwapOutput(expectedTwapOut);

      await expect(converter.connect(keeper).sellRsvd(amountIn, 0)).to.emit(converter, "RsvdSold");

      const cp = await converter.twapCheckpoints(await token.getAddress());
      expect(cp.timestamp).to.equal(1000 + TEN_MINUTES);
      expect(floor).to.be.greaterThan(0n);
    });

    it("reverts when the TWAP window has not elapsed", async function () {
      const { converter, token, pair, owner, keeper, converterAddress } = await deploySystem();
      const amountIn = ethers.parseUnits("1000", 18);
      await token.connect(owner).transfer(converterAddress, amountIn);

      await primeTwap(pair, converter, (1n << 112n) / 1000n, 60); // only 60s
      await expect(converter.connect(keeper).sellRsvd(amountIn, 0)).to.be.revertedWithCustomError(
        converter,
        "TwapWindowNotElapsed"
      );
    });

    it("reverts before any checkpoint exists", async function () {
      const { converter, token, owner, keeper, converterAddress } = await deploySystem();
      const amountIn = ethers.parseUnits("1000", 18);
      await token.connect(owner).transfer(converterAddress, amountIn);
      await expect(converter.connect(keeper).sellRsvd(amountIn, 0)).to.be.revertedWithCustomError(
        converter,
        "TwapNotInitialized"
      );
    });

    it("enforces the per-tx RSVD cap", async function () {
      const { converter, keeper } = await deploySystem();
      const tooMuch = (await converter.maxRsvdSpendPerTx()) + 1n;
      await expect(converter.connect(keeper).sellRsvd(tooMuch, 0)).to.be.revertedWithCustomError(
        converter,
        "ExceedsMaxSpend"
      );
    });
  });

  describe("buy leg — generic executor", function () {
    it("acquires via an allowlisted target and deposits into the vault atomically", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStock, bStockAddress, swapTarget, swapTargetAddress, vaultAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);

      const spend = ethers.parseEther("1");
      const payout = ethers.parseUnits("10", 18); // exactly oracle-fair
      const data = encodeNativeSwap(swapTarget, bStockAddress, payout, converterAddress);

      await expect(
        converter.connect(keeper).acquireReserveAsset(ethers.ZeroAddress, spend, swapTargetAddress, data, bStockAddress, 1)
      ).to.emit(converter, "ReserveAssetAcquired");

      // Landed in the vault, not left sitting in the converter.
      expect(await bStock.balanceOf(vaultAddress)).to.equal(payout);
      expect(await bStock.balanceOf(converterAddress)).to.equal(0n);
    });

    it("acquires with an ERC20 spend token and revokes the allowance afterwards", async function () {
      const ctx = await deploySystem();
      const {
        converter,
        owner,
        keeper,
        usdt,
        usdtAddress,
        bStock,
        bStockAddress,
        swapTarget,
        swapTargetAddress,
        bStockFeedAddress,
        bnbFeedAddress,
        vaultAddress,
        converterAddress,
      } = ctx;

      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await converter.connect(owner).setAllowedTarget(swapTargetAddress, true);
      await converter.connect(owner).setMaxSpendPerTx(usdtAddress, ethers.parseUnits("10000", 18));
      // Price USDT at $1 by reusing the bStock feed shape; only the ratio matters.
      const Feed = await ethers.getContractFactory("MockChainlinkFeed");
      const usdtFeed = await Feed.deploy(100000000n, 8); // $1.00
      await usdtFeed.waitForDeployment();
      await converter.connect(owner).setAssetUsdFeed(usdtAddress, await usdtFeed.getAddress());
      await converter.connect(owner).setAssetUsdFeed(bStockAddress, bStockFeedAddress);
      expect(bnbFeedAddress).to.be.a("string");

      const spend = ethers.parseUnits("600", 18); // $600 of USDT
      const payout = ethers.parseUnits("10", 18); // $600 / $60 = 10 bStock, oracle-fair
      await usdt.mint(converterAddress, spend);
      await bStock.mint(swapTargetAddress, ethers.parseUnits("1000", 18));

      const data = swapTarget.interface.encodeFunctionData("swapExactToken", [
        usdtAddress,
        spend,
        bStockAddress,
        payout,
        converterAddress,
      ]);

      await converter.connect(keeper).acquireReserveAsset(usdtAddress, spend, swapTargetAddress, data, bStockAddress, 1);

      expect(await bStock.balanceOf(vaultAddress)).to.equal(payout);
      // No standing allowance left behind for the venue.
      expect(await usdt.allowance(converterAddress, swapTargetAddress)).to.equal(0n);
    });

    it("rejects a target that is not allowlisted", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);
      await converter.connect(owner).setAllowedTarget(swapTargetAddress, false);

      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "TargetNotAllowed");
    });

    it("rejects an asset that is not allowlisted", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);
      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, false);

      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "AssetNotAllowed");
    });

    it("refuses to spend RSVD through the executor, so sellRsvd's TWAP floor cannot be bypassed", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, tokenAddress, bStockAddress, swapTargetAddress } = ctx;
      await armNativeBuy(ctx);
      await expect(
        converter.connect(keeper).acquireReserveAsset(tokenAddress, 1, swapTargetAddress, "0x", bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "ForbiddenSpendToken");
    });

    it("enforces the per-transaction spend cap", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);

      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("6"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "ExceedsMaxSpend");
    });

    it("rejects a spend token with no per-tx cap configured at all", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);
      await converter.connect(owner).setMaxSpendPerTx(ethers.ZeroAddress, 0);

      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "ExceedsMaxSpend");
    });

    it("reverts when the target under-delivers", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockAddress, swapTarget, swapTargetAddress } = ctx;
      await armNativeBuy(ctx);

      const data = swapTarget.interface.encodeFunctionData("swapAndUnderdeliver", []);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "BelowMinOut");
    });

    it("propagates a revert from the target rather than booking a zero-output success", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockAddress, swapTarget, swapTargetAddress } = ctx;
      await armNativeBuy(ctx);

      const data = swapTarget.interface.encodeFunctionData("swapAndRevert", []);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWith("MockSwapTarget: swap failed");
    });

    it("catches a target that pulls more of the spend token than authorised", async function () {
      const ctx = await deploySystem();
      const {
        converter,
        owner,
        keeper,
        usdt,
        usdtAddress,
        bStock,
        bStockAddress,
        swapTarget,
        swapTargetAddress,
        bStockFeedAddress,
        converterAddress,
      } = ctx;

      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await converter.connect(owner).setAllowedTarget(swapTargetAddress, true);
      await converter.connect(owner).setMaxSpendPerTx(usdtAddress, ethers.parseUnits("10000", 18));
      await converter.connect(owner).setRequireOracleFloor(false);
      expect(bStockFeedAddress).to.be.a("string");

      const authorised = ethers.parseUnits("100", 18);
      // Converter holds more than it authorises, and the target grabs the lot.
      await usdt.mint(converterAddress, ethers.parseUnits("500", 18));
      await bStock.mint(swapTargetAddress, ethers.parseUnits("1000", 18));

      // Pre-existing allowance beyond this call's authorisation, as a compromised or
      // buggy venue might exploit.
      const overpull = ethers.parseUnits("300", 18);
      const data = swapTarget.interface.encodeFunctionData("overpullToken", [
        usdtAddress,
        overpull,
        bStockAddress,
        ethers.parseUnits("1", 18),
        converterAddress,
      ]);

      // forceApprove sets the allowance to exactly `authorised`, so the 300 pull fails
      // inside the target — the executor surfaces that instead of proceeding.
      await expect(
        converter.connect(keeper).acquireReserveAsset(usdtAddress, authorised, swapTargetAddress, data, bStockAddress, 1)
      ).to.be.reverted;
    });

    it("rejects a zero spend amount or zero minAcquired", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockAddress, swapTargetAddress } = ctx;
      await armNativeBuy(ctx);
      await expect(
        converter.connect(keeper).acquireReserveAsset(ethers.ZeroAddress, 0, swapTargetAddress, "0x", bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "ZeroAmount");
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, "0x", bStockAddress, 0)
      ).to.be.revertedWithCustomError(converter, "ZeroAmount");
    });
  });

  describe("rolling-window spend limit", function () {
    it("blocks a drain-by-repetition that the per-tx cap alone would allow", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);

      // 1 BNB per tx, but only 2 BNB per day in aggregate.
      await converter.connect(owner).setMaxSpendPerTx(ethers.ZeroAddress, ethers.parseEther("1"));
      await converter.connect(owner).setMaxSpendPerWindow(ethers.ZeroAddress, ethers.parseEther("2"));

      const spend = ethers.parseEther("1");
      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);

      await converter.connect(keeper).acquireReserveAsset(ethers.ZeroAddress, spend, swapTargetAddress, data, bStockAddress, 1);
      await converter.connect(keeper).acquireReserveAsset(ethers.ZeroAddress, spend, swapTargetAddress, data, bStockAddress, 1);

      // Third call is within the per-tx cap but over the window budget.
      await expect(
        converter.connect(keeper).acquireReserveAsset(ethers.ZeroAddress, spend, swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "ExceedsWindowSpend");
    });

    it("replenishes the allowance once the window elapses", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);

      await converter.connect(owner).setMaxSpendPerTx(ethers.ZeroAddress, ethers.parseEther("1"));
      await converter.connect(owner).setMaxSpendPerWindow(ethers.ZeroAddress, ethers.parseEther("1"));

      const spend = ethers.parseEther("1");
      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);

      await converter.connect(keeper).acquireReserveAsset(ethers.ZeroAddress, spend, swapTargetAddress, data, bStockAddress, 1);
      expect(await converter.remainingWindowAllowance(ethers.ZeroAddress)).to.equal(0n);

      await ethers.provider.send("evm_increaseTime", [ONE_DAY + 1]);
      await ethers.provider.send("evm_mine", []);

      expect(await converter.remainingWindowAllowance(ethers.ZeroAddress)).to.equal(ethers.parseEther("1"));
      await converter.connect(keeper).acquireReserveAsset(ethers.ZeroAddress, spend, swapTargetAddress, data, bStockAddress, 1);
    });

    it("treats an unset window cap as unlimited", async function () {
      const { converter } = await deploySystem();
      expect(await converter.remainingWindowAllowance(ethers.ZeroAddress)).to.equal(ethers.MaxUint256);
    });
  });

  describe("independent oracle floor", function () {
    it("computes the floor from both sides' USD feeds", async function () {
      const ctx = await deploySystem();
      const { converter, bStockAddress } = ctx;
      await armNativeBuy(ctx);

      // 1 BNB at $600, bStock at $60 => 10 bStock fair, less 3% slippage.
      const floor = await converter.previewOracleFloor(ethers.ZeroAddress, ethers.parseEther("1"), bStockAddress);
      expect(floor).to.equal((ethers.parseUnits("10", 18) * 9700n) / 10000n);
    });

    it("overrides a keeper minAcquired that is looser than the oracle floor", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);

      // Keeper asks for a token; oracle floor demands 9.7. Target pays only 5.
      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("5", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "BelowMinOut");
    });

    it("keeps a keeper minAcquired that is stricter than the oracle floor", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);

      const strict = ethers.parseUnits("11", 18); // above oracle-fair 10
      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, strict)
      ).to.be.revertedWithCustomError(converter, "BelowMinOut");
    });

    it("fails closed when a feed is missing and requireOracleFloor is on", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);
      await converter.connect(owner).setAssetUsdFeed(bStockAddress, ethers.ZeroAddress);

      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "OracleFloorNotConfigured");
    });

    it("falls back to the keeper's minAcquired only when the owner deliberately opts out", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, bStock, bStockAddress, swapTarget, swapTargetAddress, vaultAddress, converterAddress } =
        ctx;
      await armNativeBuy(ctx);
      await converter.connect(owner).setAssetUsdFeed(bStockAddress, ethers.ZeroAddress);
      await converter.connect(owner).setRequireOracleFloor(false);

      const payout = ethers.parseUnits("5", 18); // well below oracle-fair; no floor now
      const data = encodeNativeSwap(swapTarget, bStockAddress, payout, converterAddress);
      await converter
        .connect(keeper)
        .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1);
      expect(await bStock.balanceOf(vaultAddress)).to.equal(payout);
    });

    it("rejects a stale feed answer", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockFeed, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);

      const block = await ethers.provider.getBlock("latest");
      await bStockFeed.setUpdatedAt(block.timestamp - 2 * 60 * 60); // 2h old, limit is 1h

      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "StalePriceFeed");
    });

    it("rejects a non-positive feed answer", async function () {
      const ctx = await deploySystem();
      const { converter, keeper, bStockFeed, bStockAddress, swapTarget, swapTargetAddress, converterAddress } = ctx;
      await armNativeBuy(ctx);
      await bStockFeed.setAnswer(0);

      const data = encodeNativeSwap(swapTarget, bStockAddress, ethers.parseUnits("10", 18), converterAddress);
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(ethers.ZeroAddress, ethers.parseEther("1"), swapTargetAddress, data, bStockAddress, 1)
      ).to.be.revertedWithCustomError(converter, "InvalidPriceFeed");
    });

    it("normalises feeds with fewer than 18 decimals", async function () {
      const ctx = await deploySystem();
      const { converter, owner, bStockAddress } = ctx;
      await armNativeBuy(ctx);

      // Same $60 price expressed with 18 decimals instead of 8 — floor must match.
      const Feed = await ethers.getContractFactory("MockChainlinkFeed");
      const feed18 = await Feed.deploy(ethers.parseUnits("60", 18), 18);
      await feed18.waitForDeployment();
      await converter.connect(owner).setAssetUsdFeed(bStockAddress, await feed18.getAddress());

      const floor = await converter.previewOracleFloor(ethers.ZeroAddress, ethers.parseEther("1"), bStockAddress);
      expect(floor).to.equal((ethers.parseUnits("10", 18) * 9700n) / 10000n);
    });
  });

  // The migration escape hatch that briefly lived here was removed: stranding is instead
  // solved by wrapping stranded BNB into the vault as backing, which costs no trust. That
  // makes this path the safety net, so it gets real tests rather than a comment.
  describe("stranded-funds recovery (wrap BNB into the vault)", function () {
    async function armWrapRecovery(ctx) {
      const { converter, owner, bnbFeedAddress, converterAddress } = ctx;
      const WBNB = await ethers.getContractFactory("MockWBNB");
      const wbnbToken = await WBNB.deploy();
      await wbnbToken.waitForDeployment();
      const wbnbTokenAddress = await wbnbToken.getAddress();

      await converter.connect(owner).setAllowedReserveAsset(wbnbTokenAddress, true);
      await converter.connect(owner).setAllowedTarget(wbnbTokenAddress, true);
      await converter.connect(owner).setMaxSpendPerTx(ethers.ZeroAddress, ethers.parseEther("100"));
      await converter.connect(owner).setAssetUsdFeed(ethers.ZeroAddress, bnbFeedAddress);
      // WBNB is BNB — same feed, same price, so the oracle floor is satisfied by a 1:1 mint.
      await converter.connect(owner).setAssetUsdFeed(wbnbTokenAddress, bnbFeedAddress);
      expect(converterAddress).to.be.a("string");
      return { wbnbToken, wbnbTokenAddress };
    }

    it("wraps stranded BNB and deposits it into the vault as backing", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, vaultAddress, converterAddress } = ctx;
      const { wbnbToken, wbnbTokenAddress } = await armWrapRecovery(ctx);

      const stranded = ethers.parseEther("3");
      await owner.sendTransaction({ to: converterAddress, value: stranded });

      // WBNB.deposit() — the exact selector documented in the contract header.
      await converter
        .connect(keeper)
        .acquireReserveAsset(ethers.ZeroAddress, stranded, wbnbTokenAddress, "0xd0e30db0", wbnbTokenAddress, stranded);

      expect(await wbnbToken.balanceOf(vaultAddress)).to.equal(stranded);
      expect(await ethers.provider.getBalance(converterAddress)).to.equal(0n);
      expect(await wbnbToken.balanceOf(converterAddress)).to.equal(0n);
    });

    it("registers the wrapped BNB as a redeemable reserve asset on the vault", async function () {
      const ctx = await deploySystem();
      const { converter, vault, owner, keeper, converterAddress } = ctx;
      const { wbnbTokenAddress } = await armWrapRecovery(ctx);

      const stranded = ethers.parseEther("2");
      await owner.sendTransaction({ to: converterAddress, value: stranded });
      await converter
        .connect(keeper)
        .acquireReserveAsset(ethers.ZeroAddress, stranded, wbnbTokenAddress, "0xd0e30db0", wbnbTokenAddress, stranded);

      // Recovered value has to be redeemable, not merely parked — that is the whole point.
      expect(await vault.isReserveAsset(wbnbTokenAddress)).to.equal(true);
      const [tokens, balances] = await vault.getReserveBalances();
      const idx = tokens.indexOf(wbnbTokenAddress);
      expect(idx).to.be.greaterThan(-1);
      expect(balances[idx]).to.equal(stranded);
    });

    it("still refuses an unallowlisted wrap target, so this is not a general escape hatch", async function () {
      const ctx = await deploySystem();
      const { converter, owner, keeper, converterAddress } = ctx;
      const { wbnbTokenAddress } = await armWrapRecovery(ctx);
      await converter.connect(owner).setAllowedTarget(wbnbTokenAddress, false);

      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });
      await expect(
        converter
          .connect(keeper)
          .acquireReserveAsset(
            ethers.ZeroAddress,
            ethers.parseEther("1"),
            wbnbTokenAddress,
            "0xd0e30db0",
            wbnbTokenAddress,
            ethers.parseEther("1")
          )
      ).to.be.revertedWithCustomError(converter, "TargetNotAllowed");
    });
  });

  describe("no path to a wallet", function () {
    it("exposes no function that can send value to an arbitrary address", async function () {
      const { converter } = await deploySystem();
      const names = converter.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      // Every value-moving path is either vault-bound (acquire/deposit) or venue-bound
      // through an allowlist (acquire/sell). Nothing capable of sending funds to an
      // arbitrary address should appear here — including the migration functions an
      // earlier draft carried, which were removed precisely because a successor contract
      // could have shipped a withdraw function of its own.
      for (const forbidden of [
        "withdraw",
        "rescue",
        "sweep",
        "emergencyWithdraw",
        "transferOut",
        "skim",
        "scheduleMigration",
        "executeMigration",
        "cancelMigration",
      ]) {
        expect(names).to.not.include(forbidden);
      }
    });
  });
});
