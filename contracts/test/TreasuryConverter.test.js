const { expect } = require("chai");
const { ethers } = require("hardhat");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18);
const TEN_MINUTES = 10 * 60;

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

  // Stand-in for WBNB — only its address matters here (used for path/token0
  // checks), never moved as an ERC20 by the converter itself.
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

  // RSVD is token0, WBNB is token1 — deliberate, exercises the "token0 == rsvd"
  // branch of _currentRsvdPerBnbCumulative.
  const Pair = await ethers.getContractFactory("MockUniswapV2Pair");
  const pair = await Pair.deploy(tokenAddress, wbnbAddress);
  await pair.waitForDeployment();
  const pairAddress = await pair.getAddress();

  // bStock is token0, USDT is token1 — the mirror pairing used by _bStockMinOutFloor.
  const bStockUsdtPair = await Pair.deploy(bStockAddress, usdtAddress);
  await bStockUsdtPair.waitForDeployment();
  const bStockUsdtPairAddress = await bStockUsdtPair.getAddress();

  const Feed = await ethers.getContractFactory("MockChainlinkFeed");
  // 8 decimals, like Chainlink's real BNB/USD feed. $300/BNB.
  const priceFeed = await Feed.deploy(30000000000n, 8);
  await priceFeed.waitForDeployment();
  const priceFeedAddress = await priceFeed.getAddress();

  const Converter = await ethers.getContractFactory("TreasuryConverter");
  const converter = await Converter.deploy(
    tokenAddress,
    vaultAddress,
    routerAddress,
    pairAddress,
    usdtAddress,
    owner.address,
    keeper.address
  );
  await converter.waitForDeployment();
  const converterAddress = await converter.getAddress();

  // Router needs real BNB on hand to pay out sellRsvd's output.
  await owner.sendTransaction({ to: routerAddress, value: ethers.parseEther("100") });

  // depositReserveAsset calls vault.depositAsset() as the converter contract itself
  // (msg.sender to the vault is the converter's address, not the EOA keeper that
  // triggers it) — so the vault needs the converter registered as its own keeper.
  // This is the intended production shape too: one less EOA with direct vault access.
  await vault.connect(owner).setKeeper(converterAddress);

  return {
    token,
    vault,
    wbnb,
    bStock,
    usdt,
    router,
    pair,
    bStockUsdtPair,
    priceFeed,
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
    bStockUsdtPairAddress,
    priceFeedAddress,
    converterAddress,
  };
}

// Sets a checkpoint of cumulative=0 at an arbitrary base timestamp, then a second
// cumulative value `elapsedSeconds` later chosen so that (cumulativeDelta / elapsed)
// equals exactly `priceX112PerRsvd` — lets a test dictate the TWAP the contract will
// compute, rather than reverse-engineering it from reserves. Uses the mock pair's own
// self-reported blockTimestampLast throughout, not real chain time — the contract never
// reads block.timestamp for the TWAP math, only the pair's reported timestamps, so this
// is fully decoupled from (and doesn't need to advance) the actual EVM clock.
async function primeTwap(pair, converter, priceX112PerRsvd, elapsedSeconds) {
  const t0 = 1000;
  await pair.setReserves(0, 0, t0);
  await pair.setCumulativePrices(0, 0);
  await converter.updateTwapCheckpoint();

  const t1 = t0 + elapsedSeconds;
  const cumulativeDelta = priceX112PerRsvd * BigInt(elapsedSeconds);
  await pair.setReserves(0, 0, t1);
  await pair.setCumulativePrices(cumulativeDelta, 0);
}

// Same idea as primeTwap, but for a bStock/USDT pair checkpointed via
// updateBStockTwapCheckpoint(bStock) instead of the RSVD/BNB-specific
// updateTwapCheckpoint(). priceX112PerBStock is USDT-per-bStock (bStock is token0,
// USDT is token1 in deploySystem's bStockUsdtPair).
async function primeBStockTwap(bStockUsdtPair, converter, bStockAddress, priceX112PerBStock, elapsedSeconds) {
  const t0 = 1000;
  await bStockUsdtPair.setReserves(0, 0, t0);
  await bStockUsdtPair.setCumulativePrices(0, 0);
  await converter.updateBStockTwapCheckpoint(bStockAddress);

  const t1 = t0 + elapsedSeconds;
  const cumulativeDelta = priceX112PerBStock * BigInt(elapsedSeconds);
  await bStockUsdtPair.setReserves(0, 0, t1);
  await bStockUsdtPair.setCumulativePrices(cumulativeDelta, 0);
}

describe("TreasuryConverter", function () {
  describe("access control", function () {
    it("rejects a zero address in the constructor", async function () {
      const { tokenAddress, vaultAddress, routerAddress, pairAddress, usdtAddress, owner, keeper } = await deploySystem();
      const Converter = await ethers.getContractFactory("TreasuryConverter");
      await expect(
        Converter.deploy(
          ethers.ZeroAddress,
          vaultAddress,
          routerAddress,
          pairAddress,
          usdtAddress,
          owner.address,
          keeper.address
        )
      ).to.be.revertedWithCustomError(Converter, "ZeroAddress");
    });

    it("rejects a non-18-decimal USDT in the constructor", async function () {
      const { tokenAddress, vaultAddress, routerAddress, pairAddress, owner, keeper } = await deploySystem();
      const SixDecimals = await ethers.getContractFactory("MockERC20CustomDecimals");
      const usdt6 = await SixDecimals.deploy("Six Decimal USDT", "USDT6", 6);
      await usdt6.waitForDeployment();
      const usdt6Address = await usdt6.getAddress();

      const Converter = await ethers.getContractFactory("TreasuryConverter");
      await expect(
        Converter.deploy(tokenAddress, vaultAddress, routerAddress, pairAddress, usdt6Address, owner.address, keeper.address)
      ).to.be.revertedWithCustomError(Converter, "UnsupportedDecimals");
    });

    it("only the keeper (or owner) can call sellRsvd, buyReserveAsset, or depositReserveAsset", async function () {
      const { converter, other } = await deploySystem();
      await expect(converter.connect(other).sellRsvd(1, 0)).to.be.revertedWithCustomError(converter, "NotKeeper");
      await expect(converter.connect(other).buyReserveAsset(1, 0, ethers.ZeroAddress, [])).to.be.revertedWithCustomError(
        converter,
        "NotKeeper"
      );
      await expect(converter.connect(other).depositReserveAsset(ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(
        converter,
        "NotKeeper"
      );
    });

    it("only the owner can change admin settings", async function () {
      const { converter, other } = await deploySystem();
      await expect(converter.connect(other).setKeeper(other.address)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
      await expect(converter.connect(other).setMaxSlippageBps(100)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
      await expect(converter.connect(other).setAllowedReserveAsset(other.address, true)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
    });

    it("caps max slippage at the hard ceiling", async function () {
      const { converter, owner } = await deploySystem();
      await expect(converter.connect(owner).setMaxSlippageBps(1001)).to.be.revertedWithCustomError(converter, "SlippageTooHigh");
      await expect(converter.connect(owner).setMaxSlippageBps(1000)).to.not.be.reverted;
    });

    it("has no withdraw or rescue function of any kind", async function () {
      const { converter } = await deploySystem();
      const fragments = converter.interface.fragments.map((f) => f.name).filter(Boolean);
      for (const name of fragments) {
        expect(name.toLowerCase()).to.not.include("withdraw");
        expect(name.toLowerCase()).to.not.include("rescue");
        expect(name.toLowerCase()).to.not.include("sweep");
      }
    });
  });

  describe("sellRsvd", function () {
    it("reverts before the TWAP checkpoint has ever been initialized", async function () {
      const { converter, keeper } = await deploySystem();
      await expect(converter.connect(keeper).sellRsvd(1, 0)).to.be.revertedWithCustomError(converter, "TwapNotInitialized");
    });

    it("reverts if called before minTwapWindow has elapsed since the checkpoint", async function () {
      const { converter, keeper, pair } = await deploySystem();
      // Nonzero pair timestamp — distinguishes "checkpointed, window not elapsed yet"
      // from "never checkpointed" (blockTimestampLast still 0 -> TwapNotInitialized).
      await pair.setReserves(0, 0, 1000);
      await converter.updateTwapCheckpoint();
      await expect(converter.connect(keeper).sellRsvd(1, 0)).to.be.revertedWithCustomError(converter, "TwapWindowNotElapsed");
    });

    it("reverts if amountIn exceeds maxRsvdSpendPerTx (checked before the TWAP state)", async function () {
      const { converter, owner, keeper } = await deploySystem();
      await converter.connect(owner).setMaxRsvdSpendPerTx(ethers.parseUnits("1000", 18));
      // No checkpoint primed at all — the spend-cap check reverts first regardless.
      await expect(
        converter.connect(keeper).sellRsvd(ethers.parseUnits("2000", 18), 0)
      ).to.be.revertedWithCustomError(converter, "ExceedsMaxSpend");
    });

    it("computes the min-out floor from the TWAP, rejects a below-floor swap, and accepts an at-floor one", async function () {
      const { converter, pair, token, owner, keeper, router, converterAddress } = await deploySystem();
      await token.connect(owner).transfer(converterAddress, ethers.parseUnits("10000", 18));

      // Price: 1 BNB per 1,000,000 RSVD, i.e. 1e-6 BNB/RSVD, held for 700s (> 10 min).
      const priceX112 = 2n ** 112n / 1000000n;
      await primeTwap(pair, converter, priceX112, TEN_MINUTES + 100);

      const amountIn = ethers.parseUnits("1000", 18); // 1000 RSVD
      const twapMinOut = (amountIn * priceX112) >> 112n; // = 0.001 BNB = 1e15 wei
      const floorMinOut = (twapMinOut * (10000n - 300n)) / 10000n; // 3% default slippage

      // Router configured to pay out exactly 1 wei below the floor -> must revert.
      await router.setNextSwapOutput(floorMinOut - 1n);
      await expect(converter.connect(keeper).sellRsvd(amountIn, 0)).to.be.reverted;

      // At (or above) the floor, it succeeds and reports the real balance-delta output.
      await router.setNextSwapOutput(floorMinOut);
      const bnbBefore = await ethers.provider.getBalance(converterAddress);
      await expect(converter.connect(keeper).sellRsvd(amountIn, 0))
        .to.emit(converter, "RsvdSold")
        .withArgs(amountIn, floorMinOut, floorMinOut);
      const bnbAfter = await ethers.provider.getBalance(converterAddress);
      expect(bnbAfter - bnbBefore).to.equal(floorMinOut);
    });

    it("uses the keeper-supplied minOut when it's stricter than the TWAP floor", async function () {
      const { converter, pair, token, owner, keeper, router, converterAddress } = await deploySystem();
      await token.connect(owner).transfer(converterAddress, ethers.parseUnits("10000", 18));

      const priceX112 = 2n ** 112n / 1000000n;
      await primeTwap(pair, converter, priceX112, TEN_MINUTES + 100);

      const amountIn = ethers.parseUnits("1000", 18);
      const twapMinOut = (amountIn * priceX112) >> 112n;
      const floorMinOut = (twapMinOut * (10000n - 300n)) / 10000n;
      const strictKeeperMinOut = floorMinOut + ethers.parseUnits("0.0001", 18);

      // Router pays exactly the TWAP floor — enough to pass the floor check, but
      // below the keeper's stricter requested minimum, so it must still revert.
      await router.setNextSwapOutput(floorMinOut);
      await expect(converter.connect(keeper).sellRsvd(amountIn, strictKeeperMinOut)).to.be.reverted;
    });

    it("re-checkpoints after a successful sell, rate-limiting the next one", async function () {
      const { converter, pair, token, owner, keeper, router, converterAddress } = await deploySystem();
      await token.connect(owner).transfer(converterAddress, ethers.parseUnits("10000", 18));

      const priceX112 = 2n ** 112n / 1000000n;
      await primeTwap(pair, converter, priceX112, TEN_MINUTES + 100);

      const amountIn = ethers.parseUnits("1000", 18);
      const twapMinOut = (amountIn * priceX112) >> 112n;
      const floorMinOut = (twapMinOut * (10000n - 300n)) / 10000n;
      await router.setNextSwapOutput(floorMinOut);
      await converter.connect(keeper).sellRsvd(amountIn, 0);

      // Pair state hasn't moved since (still reporting the same cumulative/timestamp
      // as the moment of the last checkpoint) -> elapsed is 0 -> must revert.
      await expect(converter.connect(keeper).sellRsvd(amountIn, 0)).to.be.revertedWithCustomError(
        converter,
        "TwapWindowNotElapsed"
      );
    });

    it("lets the owner call sellRsvd directly too, same as the keeper", async function () {
      const { converter, pair, token, owner, router, converterAddress } = await deploySystem();
      await token.connect(owner).transfer(converterAddress, ethers.parseUnits("10000", 18));

      const priceX112 = 2n ** 112n / 1000000n;
      await primeTwap(pair, converter, priceX112, TEN_MINUTES + 100);

      const amountIn = ethers.parseUnits("1000", 18);
      const twapMinOut = (amountIn * priceX112) >> 112n;
      const floorMinOut = (twapMinOut * (10000n - 300n)) / 10000n;
      await router.setNextSwapOutput(floorMinOut);

      await expect(converter.connect(owner).sellRsvd(amountIn, 0)).to.not.be.reverted;
    });
  });

  describe("buyReserveAsset", function () {
    it("reverts for a non-allowlisted target token", async function () {
      const { converter, keeper, wbnbAddress, bStockAddress, converterAddress, owner } = await deploySystem();
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });
      await expect(
        converter.connect(keeper).buyReserveAsset(ethers.parseEther("0.1"), 0, bStockAddress, [wbnbAddress, bStockAddress])
      ).to.be.revertedWithCustomError(converter, "AssetNotAllowed");
    });

    it("reverts if bnbIn exceeds maxBnbSpendPerTx", async function () {
      const { converter, owner, keeper, bStockAddress, wbnbAddress, converterAddress } = await deploySystem();
      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await converter.connect(owner).setMaxBnbSpendPerTx(ethers.parseEther("1"));
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("5") });
      await expect(
        converter.connect(keeper).buyReserveAsset(ethers.parseEther("2"), 0, bStockAddress, [wbnbAddress, bStockAddress])
      ).to.be.revertedWithCustomError(converter, "ExceedsMaxSpend");
    });

    it("reverts on a path that doesn't start at WBNB or end at the target token", async function () {
      const { converter, owner, keeper, bStockAddress, wbnbAddress, converterAddress, other } = await deploySystem();
      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });
      await expect(
        converter.connect(keeper).buyReserveAsset(ethers.parseEther("0.1"), 0, bStockAddress, [other.address, bStockAddress])
      ).to.be.revertedWithCustomError(converter, "InvalidPath");
      await expect(
        converter.connect(keeper).buyReserveAsset(ethers.parseEther("0.1"), 0, bStockAddress, [wbnbAddress, other.address])
      ).to.be.revertedWithCustomError(converter, "InvalidPath");
    });

    it("buys the allowlisted token, tracked by real balance delta", async function () {
      const { converter, owner, keeper, bStock, bStockAddress, wbnbAddress, converterAddress, router, routerAddress } =
        await deploySystem();
      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      // No USDT pair/price feed configured for this asset — use the escape hatch so
      // this test can focus on balance-delta accounting; the price-floor behavior
      // itself is covered by the "buyReserveAsset price floor (oracle)" suite below.
      await converter.connect(owner).setRequirePriceFloorForBuys(false);
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });

      const buyOut = ethers.parseUnits("500", 18);
      await bStock.mint(routerAddress, buyOut);
      await router.setNextSwapOutput(buyOut);

      await expect(
        converter.connect(keeper).buyReserveAsset(ethers.parseEther("0.1"), buyOut, bStockAddress, [wbnbAddress, bStockAddress])
      )
        .to.emit(converter, "ReserveAssetBought")
        .withArgs(bStockAddress, ethers.parseEther("0.1"), buyOut, buyOut);
      expect(await bStock.balanceOf(converterAddress)).to.equal(buyOut);
    });
  });

  describe("buyReserveAsset price floor (oracle)", function () {
    it("reverts when no USDT pair/price feed is configured, since requirePriceFloorForBuys defaults to true", async function () {
      const { converter, owner, keeper, bStockAddress, wbnbAddress, converterAddress } = await deploySystem();
      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });

      await expect(
        converter.connect(keeper).buyReserveAsset(ethers.parseEther("0.1"), 0, bStockAddress, [wbnbAddress, bStockAddress])
      ).to.be.revertedWithCustomError(converter, "PriceFloorNotConfigured");
    });

    it("computes the min-out floor from the bStock/USDT TWAP + Chainlink BNB/USD feed, rejects a below-floor buy, and accepts an at-floor one", async function () {
      const {
        converter,
        owner,
        keeper,
        bStock,
        bStockAddress,
        wbnbAddress,
        bStockUsdtPair,
        priceFeedAddress,
        bStockUsdtPairAddress,
        converterAddress,
        router,
        routerAddress,
      } = await deploySystem();

      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await converter.connect(owner).setPriceFeed(priceFeedAddress);
      await converter.connect(owner).setBStockUsdtPair(bStockAddress, bStockUsdtPairAddress);
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });

      // 30 USDT per bStock.
      const priceX112PerBStock = 30n * 2n ** 112n;
      await primeBStockTwap(bStockUsdtPair, converter, bStockAddress, priceX112PerBStock, TEN_MINUTES + 100);

      // priceFeed reports $300/BNB (8 decimals) — see deploySystem. 1 BNB in -> $300 ->
      // at $30/bStock, 10 bStock, minus the default 3% slippage.
      const bnbIn = ethers.parseEther("1");
      const twapMinOut = ethers.parseUnits("10", 18);
      const floorMinOut = (twapMinOut * (10000n - 300n)) / 10000n;

      await bStock.mint(routerAddress, floorMinOut - 1n);
      await router.setNextSwapOutput(floorMinOut - 1n);
      await expect(converter.connect(keeper).buyReserveAsset(bnbIn, 0, bStockAddress, [wbnbAddress, bStockAddress])).to.be
        .reverted;

      await bStock.mint(routerAddress, floorMinOut);
      await router.setNextSwapOutput(floorMinOut);
      await expect(converter.connect(keeper).buyReserveAsset(bnbIn, 0, bStockAddress, [wbnbAddress, bStockAddress]))
        .to.emit(converter, "ReserveAssetBought")
        .withArgs(bStockAddress, bnbIn, floorMinOut, floorMinOut);
    });

    it("uses the keeper-supplied minOut when it's stricter than the TWAP+feed floor", async function () {
      const {
        converter,
        owner,
        keeper,
        bStock,
        bStockAddress,
        wbnbAddress,
        bStockUsdtPair,
        priceFeedAddress,
        bStockUsdtPairAddress,
        converterAddress,
        router,
        routerAddress,
      } = await deploySystem();

      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await converter.connect(owner).setPriceFeed(priceFeedAddress);
      await converter.connect(owner).setBStockUsdtPair(bStockAddress, bStockUsdtPairAddress);
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });

      const priceX112PerBStock = 30n * 2n ** 112n;
      await primeBStockTwap(bStockUsdtPair, converter, bStockAddress, priceX112PerBStock, TEN_MINUTES + 100);

      const bnbIn = ethers.parseEther("1");
      const twapMinOut = ethers.parseUnits("10", 18);
      const floorMinOut = (twapMinOut * (10000n - 300n)) / 10000n;
      const strictKeeperMinOut = floorMinOut + ethers.parseUnits("0.0001", 18);

      // Router pays exactly the TWAP+feed floor — enough to pass that check, but below
      // the keeper's stricter requested minimum, so it must still revert.
      await bStock.mint(routerAddress, floorMinOut);
      await router.setNextSwapOutput(floorMinOut);
      await expect(converter.connect(keeper).buyReserveAsset(bnbIn, strictKeeperMinOut, bStockAddress, [wbnbAddress, bStockAddress]))
        .to.be.reverted;
    });

    it("reverts if the price feed reports a non-positive answer", async function () {
      const {
        converter,
        owner,
        keeper,
        bStockAddress,
        wbnbAddress,
        bStockUsdtPair,
        priceFeed,
        priceFeedAddress,
        bStockUsdtPairAddress,
        converterAddress,
      } = await deploySystem();

      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      await converter.connect(owner).setPriceFeed(priceFeedAddress);
      await converter.connect(owner).setBStockUsdtPair(bStockAddress, bStockUsdtPairAddress);
      await owner.sendTransaction({ to: converterAddress, value: ethers.parseEther("1") });

      const priceX112PerBStock = 30n * 2n ** 112n;
      await primeBStockTwap(bStockUsdtPair, converter, bStockAddress, priceX112PerBStock, TEN_MINUTES + 100);
      await priceFeed.setAnswer(0);

      await expect(
        converter.connect(keeper).buyReserveAsset(ethers.parseEther("1"), 0, bStockAddress, [wbnbAddress, bStockAddress])
      ).to.be.revertedWithCustomError(converter, "InvalidPriceFeed");
    });

    it("setBStockUsdtPair reverts for a non-18-decimal bStock", async function () {
      const { converter, owner, bStockUsdtPairAddress } = await deploySystem();
      const SixDecimals = await ethers.getContractFactory("MockERC20CustomDecimals");
      const badBStock = await SixDecimals.deploy("Six Decimal Stock", "BAD6", 6);
      await badBStock.waitForDeployment();
      const badBStockAddress = await badBStock.getAddress();

      await expect(
        converter.connect(owner).setBStockUsdtPair(badBStockAddress, bStockUsdtPairAddress)
      ).to.be.revertedWithCustomError(converter, "UnsupportedDecimals");

      // Clearing the pair (address(0)) never needs to assert decimals.
      await expect(converter.connect(owner).setBStockUsdtPair(badBStockAddress, ethers.ZeroAddress)).to.not.be.reverted;
    });

    it("only the owner can call setPriceFeed, setBStockUsdtPair, or setRequirePriceFloorForBuys", async function () {
      const { converter, other, bStockAddress, bStockUsdtPairAddress, priceFeedAddress } = await deploySystem();
      await expect(converter.connect(other).setPriceFeed(priceFeedAddress)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
      await expect(
        converter.connect(other).setBStockUsdtPair(bStockAddress, bStockUsdtPairAddress)
      ).to.be.revertedWithCustomError(converter, "OwnableUnauthorizedAccount");
      await expect(converter.connect(other).setRequirePriceFloorForBuys(false)).to.be.revertedWithCustomError(
        converter,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("depositReserveAsset", function () {
    it("reverts for a non-allowlisted token", async function () {
      const { converter, keeper, bStockAddress } = await deploySystem();
      await expect(converter.connect(keeper).depositReserveAsset(bStockAddress, 1)).to.be.revertedWithCustomError(
        converter,
        "AssetNotAllowed"
      );
    });

    it("forwards an allowlisted asset into the real vault", async function () {
      const { converter, vault, owner, keeper, bStock, bStockAddress, converterAddress, vaultAddress } = await deploySystem();
      await converter.connect(owner).setAllowedReserveAsset(bStockAddress, true);
      const amount = ethers.parseUnits("250", 18);
      await bStock.mint(converterAddress, amount);

      await expect(converter.connect(keeper).depositReserveAsset(bStockAddress, amount))
        .to.emit(converter, "ReserveAssetDeposited")
        .withArgs(bStockAddress, amount);

      expect(await bStock.balanceOf(vaultAddress)).to.equal(amount);
      expect(await vault.isReserveAsset(bStockAddress)).to.equal(true);
    });
  });
});
