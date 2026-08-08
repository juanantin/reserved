// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReservedToken} from "./ReservedToken.sol";

interface IPancakeRouterLike {
    function WETH() external view returns (address);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

interface IUniswapV2PairLike {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
}

interface IReservedVaultLike {
    function depositAsset(address token, uint256 amount) external;
}

interface IChainlinkFeedLike {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/// @title TreasuryConverter
/// @notice Set as ReservedToken.treasury so tax revenue lands here instead of a wallet.
/// The keeper can trigger conversions (RSVD -> BNB -> bStock -> vault deposit), but every
/// path value can leave through is bounded — there is deliberately no withdraw/rescue
/// function of any kind, for the owner or anyone else. A compromised keeper key can only
/// trigger capped, price-checked, pre-allowlisted purchases into the vault; it cannot
/// extract value. This is the same guarantee backed.is's vault gives ("no owner or keeper
/// path to withdraw stocks or ETH") — see PROJECT_BRIEF.md and contracts/README.md.
///
/// @dev Both conversion legs are protected by a genuine, manipulation-resistant TWAP —
/// not spot price, which a compromised/malicious keeper (or anyone who can get a
/// keeper-authorized call included) could otherwise manipulate via a single sandwich
/// transaction:
///  - sellRsvd checks the RSVD/BNB pair's own cumulative-price accumulator directly (the
///    standard UniswapV2 oracle pattern).
///  - buyReserveAsset checks each bStock's USDT pair the same way, converted to a BNB
///    terms via Chainlink's BNB/USD feed (a genuinely independent, off-chain-aggregated
///    price source, not a single AMM pool) — see requirePriceFloorForBuys below for what
///    happens when that isn't configured for a given asset.
///
/// Both RSVD and every allowlisted bStock, plus USDT, are asserted to use 18 decimals at
/// configuration time (reverting otherwise) rather than the math silently assuming it —
/// this is the overwhelmingly dominant convention for BEP-20 tokens on BSC, but asserted,
/// not trusted blindly.
contract TreasuryConverter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct TwapCheckpoint {
        uint256 cumulative;
        uint32 timestamp;
    }

    ReservedToken public immutable rsvd;
    IReservedVaultLike public immutable vault;
    address public immutable WBNB;
    address public immutable USDT;

    IPancakeRouterLike public router;
    address public rsvdBnbPair;
    address public keeper;

    /// @notice Chainlink BNB/USD aggregator, used to price buyReserveAsset's floor in
    /// terms of each bStock's USDT pair. address(0) disables it (see requirePriceFloorForBuys).
    address public priceFeed;

    /// @notice If true (default), buyReserveAsset reverts for any target token that
    /// doesn't have both a configured USDT pair and a working price feed, instead of
    /// silently falling back to trusting the keeper's minOut alone. Owner can relax this
    /// deliberately; the default is the safe one.
    bool public requirePriceFloorForBuys = true;

    /// @notice USDT pair for each allowlisted bStock, used to compute buyReserveAsset's
    /// price floor. Owner-set alongside setAllowedReserveAsset.
    mapping(address => address) public bStockUsdtPair;

    /// @notice Per-call caps — bound the blast radius of a compromised keeper key.
    uint256 public maxRsvdSpendPerTx = 5_000_000 ether;
    uint256 public maxBnbSpendPerTx = 5 ether;

    /// @notice Max allowed slippage below the TWAP price, in bps, for both conversion legs.
    uint256 public maxSlippageBps = 300; // 3%
    uint256 public constant MAX_SLIPPAGE_BPS_CAP = 1000; // 10% hard ceiling, like ReservedToken's tax cap

    /// @notice Minimum elapsed time between TWAP checkpoints for a given pair. Also
    /// rate-limits sellRsvd (which re-checkpoints on every call) to at most once per window.
    uint256 public minTwapWindow = 10 minutes;

    /// @notice TWAP checkpoints, keyed by "subject" token: address(rsvd) for the RSVD/BNB
    /// checkpoint sellRsvd uses, or a bStock's address for its bStock/USDT checkpoint.
    mapping(address => TwapCheckpoint) public twapCheckpoints;

    mapping(address => bool) public isAllowedReserveAsset;

    event KeeperUpdated(address indexed previousKeeper, address indexed newKeeper);
    event RouterUpdated(address indexed router);
    event RsvdBnbPairUpdated(address indexed pair);
    event PriceFeedUpdated(address indexed feed);
    event RequirePriceFloorForBuysUpdated(bool value);
    event BStockUsdtPairUpdated(address indexed bStock, address indexed pair);
    event MaxRsvdSpendPerTxUpdated(uint256 value);
    event MaxBnbSpendPerTxUpdated(uint256 value);
    event MaxSlippageBpsUpdated(uint256 value);
    event MinTwapWindowUpdated(uint256 value);
    event AllowedReserveAssetUpdated(address indexed token, bool allowed);
    event TwapCheckpointUpdated(address indexed subject, uint256 cumulative, uint32 timestamp);
    event RsvdSold(uint256 amountIn, uint256 bnbOut, uint256 minOut);
    event ReserveAssetBought(address indexed token, uint256 bnbIn, uint256 tokenOut, uint256 minOut);
    event ReserveAssetDeposited(address indexed token, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NotKeeper();
    error ExceedsMaxSpend();
    error SlippageTooHigh(uint256 requested, uint256 max);
    error TwapWindowNotElapsed();
    error TwapNotInitialized();
    error AssetNotAllowed(address token);
    error BelowMinOut(uint256 actual, uint256 required);
    error InvalidPath();
    error UnsupportedDecimals(address token, uint8 decimals);
    error PriceFloorNotConfigured(address token);
    error InvalidPriceFeed();

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(
        address rsvd_,
        address vault_,
        address router_,
        address rsvdBnbPair_,
        address usdt_,
        address initialOwner_,
        address keeper_
    ) Ownable(initialOwner_) {
        if (
            rsvd_ == address(0) ||
            vault_ == address(0) ||
            router_ == address(0) ||
            rsvdBnbPair_ == address(0) ||
            usdt_ == address(0) ||
            keeper_ == address(0)
        ) revert ZeroAddress();

        _requireEighteenDecimals(usdt_);

        rsvd = ReservedToken(rsvd_);
        vault = IReservedVaultLike(vault_);
        router = IPancakeRouterLike(router_);
        rsvdBnbPair = rsvdBnbPair_;
        USDT = usdt_;
        WBNB = IPancakeRouterLike(router_).WETH();
        keeper = keeper_;
        emit KeeperUpdated(address(0), keeper_);
    }

    function _requireEighteenDecimals(address token) internal view {
        uint8 dec = IERC20Metadata(token).decimals();
        if (dec != 18) revert UnsupportedDecimals(token, dec);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    function setRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert ZeroAddress();
        router = IPancakeRouterLike(newRouter);
        emit RouterUpdated(newRouter);
    }

    function setRsvdBnbPair(address newPair) external onlyOwner {
        if (newPair == address(0)) revert ZeroAddress();
        rsvdBnbPair = newPair;
        emit RsvdBnbPairUpdated(newPair);
    }

    function setPriceFeed(address newFeed) external onlyOwner {
        priceFeed = newFeed;
        emit PriceFeedUpdated(newFeed);
    }

    /// @notice Owner-only escape hatch to allow buyReserveAsset for assets without a
    /// configured price floor, trusting the keeper's minOut alone for those. Off by
    /// default — turning this on is a deliberate, logged decision, not a silent gap.
    function setRequirePriceFloorForBuys(bool value) external onlyOwner {
        requirePriceFloorForBuys = value;
        emit RequirePriceFloorForBuysUpdated(value);
    }

    /// @notice Sets (or clears, with address(0)) the USDT pair used to price `bStock`'s
    /// buyReserveAsset floor. Asserts both `bStock` and USDT are 18 decimals.
    function setBStockUsdtPair(address bStock, address pair) external onlyOwner {
        if (bStock == address(0)) revert ZeroAddress();
        if (pair != address(0)) _requireEighteenDecimals(bStock);
        bStockUsdtPair[bStock] = pair;
        emit BStockUsdtPairUpdated(bStock, pair);
    }

    function setMaxRsvdSpendPerTx(uint256 value) external onlyOwner {
        maxRsvdSpendPerTx = value;
        emit MaxRsvdSpendPerTxUpdated(value);
    }

    function setMaxBnbSpendPerTx(uint256 value) external onlyOwner {
        maxBnbSpendPerTx = value;
        emit MaxBnbSpendPerTxUpdated(value);
    }

    function setMaxSlippageBps(uint256 value) external onlyOwner {
        if (value > MAX_SLIPPAGE_BPS_CAP) revert SlippageTooHigh(value, MAX_SLIPPAGE_BPS_CAP);
        maxSlippageBps = value;
        emit MaxSlippageBpsUpdated(value);
    }

    function setMinTwapWindow(uint256 value) external onlyOwner {
        minTwapWindow = value;
        emit MinTwapWindowUpdated(value);
    }

    function setAllowedReserveAsset(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        isAllowedReserveAsset[token] = allowed;
        emit AllowedReserveAssetUpdated(token, allowed);
    }

    // ---------------------------------------------------------------------
    // TWAP checkpoints
    // ---------------------------------------------------------------------

    /// @notice Records the current RSVD/BNB cumulative price. Callable by anyone — there's
    /// nothing to exploit by recording a fresh checkpoint, it only ever narrows the window
    /// sellRsvd will later measure. Must be called once after deployment before sellRsvd
    /// can be used; sellRsvd re-checkpoints automatically on every successful call.
    function updateTwapCheckpoint() public {
        _updateCheckpoint(rsvdBnbPair, address(rsvd));
    }

    /// @notice Records the current bStock/USDT cumulative price for `bStock`'s
    /// buyReserveAsset price floor. Must have a pair configured via setBStockUsdtPair
    /// first. Callable by anyone, same reasoning as updateTwapCheckpoint.
    function updateBStockTwapCheckpoint(address bStock) public {
        address pairAddr = bStockUsdtPair[bStock];
        if (pairAddr == address(0)) revert PriceFloorNotConfigured(bStock);
        _updateCheckpoint(pairAddr, bStock);
    }

    function _updateCheckpoint(address pairAddr, address subject) internal {
        (uint256 cumulative, uint32 timestamp) = _currentCumulative(pairAddr, subject);
        twapCheckpoints[subject] = TwapCheckpoint(cumulative, timestamp);
        emit TwapCheckpointUpdated(subject, cumulative, timestamp);
    }

    /// @dev Returns the cumulative price of `subject` in terms of the pair's other token.
    function _currentCumulative(address pairAddr, address subject) internal view returns (uint256 cumulative, uint32 timestamp) {
        IUniswapV2PairLike p = IUniswapV2PairLike(pairAddr);
        address token0 = p.token0();
        (, , uint32 blockTimestampLast) = p.getReserves();
        cumulative = (token0 == subject) ? p.price0CumulativeLast() : p.price1CumulativeLast();
        timestamp = blockTimestampLast;
    }

    /// @dev Average price of `subject` (in terms of the pair's other token) since the
    /// stored checkpoint, as a UQ112x112 fixed-point value, plus the fresh (cumulative,
    /// timestamp) pair the caller should re-checkpoint to afterward. Reverts if no
    /// checkpoint exists yet or if minTwapWindow hasn't elapsed since it was recorded.
    function _twapSinceCheckpoint(
        address pairAddr,
        address subject
    ) internal view returns (uint256 avgPriceX112, uint256 nowCumulative, uint32 nowTimestamp) {
        TwapCheckpoint memory cp = twapCheckpoints[subject];
        if (cp.timestamp == 0) revert TwapNotInitialized();

        (nowCumulative, nowTimestamp) = _currentCumulative(pairAddr, subject);

        uint32 elapsed;
        uint256 cumulativeDelta;
        unchecked {
            // UniswapV2's cumulative price and block timestamp are both designed to wrap
            // (overflow) over long enough periods; subtracting with wraparound arithmetic
            // still recovers the correct delta as long as less than a full wrap has
            // occurred since the last checkpoint, which holds here since every consumer
            // re-checkpoints on use. This mirrors Uniswap's own reference oracle pattern.
            elapsed = nowTimestamp - cp.timestamp;
            cumulativeDelta = nowCumulative - cp.cumulative;
        }
        if (elapsed == 0 || elapsed < minTwapWindow) revert TwapWindowNotElapsed();

        avgPriceX112 = cumulativeDelta / elapsed;
    }

    // ---------------------------------------------------------------------
    // Conversions — the only ways value can ever leave this contract.
    // ---------------------------------------------------------------------

    /// @notice Sells up to maxRsvdSpendPerTx of this contract's RSVD for BNB, bounded by a
    /// TWAP-derived price floor so a compromised keeper key can't sandwich this contract
    /// for more than maxSlippageBps below the real average price.
    function sellRsvd(uint256 amountIn, uint256 keeperMinOut) external onlyKeeper nonReentrant returns (uint256 bnbOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > maxRsvdSpendPerTx) revert ExceedsMaxSpend();

        (uint256 avgPriceX112, uint256 nowCumulative, uint32 nowTimestamp) = _twapSinceCheckpoint(rsvdBnbPair, address(rsvd));

        uint256 twapMinOut = (amountIn * avgPriceX112) >> 112;
        uint256 floorMinOut = (twapMinOut * (10_000 - maxSlippageBps)) / 10_000;
        uint256 minOut = keeperMinOut > floorMinOut ? keeperMinOut : floorMinOut;

        address[] memory path = new address[](2);
        path[0] = address(rsvd);
        path[1] = WBNB;

        uint256 bnbBefore = address(this).balance;
        IERC20(address(rsvd)).forceApprove(address(router), amountIn);
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, minOut, path, address(this), block.timestamp);
        bnbOut = address(this).balance - bnbBefore;
        if (bnbOut < minOut) revert BelowMinOut(bnbOut, minOut);

        // Re-checkpoint so the next call prices off a fresh window instead of a stale one,
        // and so it can't be called again until minTwapWindow has passed.
        twapCheckpoints[address(rsvd)] = TwapCheckpoint(nowCumulative, nowTimestamp);
        emit TwapCheckpointUpdated(address(rsvd), nowCumulative, nowTimestamp);
        emit RsvdSold(amountIn, bnbOut, minOut);
    }

    /// @notice Buys `targetToken` (a bStock, must be pre-allowlisted) with up to
    /// maxBnbSpendPerTx of this contract's BNB. `path` must start at WBNB and end at
    /// targetToken. If a USDT pair and a working Chainlink feed are configured for
    /// `targetToken`, the swap is bounded by a TWAP-derived floor the same way sellRsvd is
    /// (see _bStockMinOutFloor). If not, this reverts unless requirePriceFloorForBuys has
    /// been deliberately turned off — see the contract-level @dev note for why that's the
    /// weaker leg and the default is to fail closed, not silently trust the keeper.
    function buyReserveAsset(
        uint256 bnbIn,
        uint256 keeperMinOut,
        address targetToken,
        address[] calldata path
    ) external onlyKeeper nonReentrant returns (uint256 tokenOut) {
        if (bnbIn == 0) revert ZeroAmount();
        if (bnbIn > maxBnbSpendPerTx) revert ExceedsMaxSpend();
        if (bnbIn > address(this).balance) revert ExceedsMaxSpend();
        if (!isAllowedReserveAsset[targetToken]) revert AssetNotAllowed(targetToken);
        if (path.length < 2 || path[0] != WBNB || path[path.length - 1] != targetToken) revert InvalidPath();

        uint256 minOut = keeperMinOut;
        address pairAddr = bStockUsdtPair[targetToken];
        bool priceFloorAvailable = pairAddr != address(0) && priceFeed != address(0);
        if (priceFloorAvailable) {
            uint256 floor = _bStockMinOutFloor(targetToken, pairAddr, bnbIn);
            if (floor > minOut) minOut = floor;
        } else if (requirePriceFloorForBuys) {
            revert PriceFloorNotConfigured(targetToken);
        }

        uint256 tokenBefore = IERC20(targetToken).balanceOf(address(this));
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: bnbIn}(minOut, path, address(this), block.timestamp);
        tokenOut = IERC20(targetToken).balanceOf(address(this)) - tokenBefore;
        if (tokenOut < minOut) revert BelowMinOut(tokenOut, minOut);

        emit ReserveAssetBought(targetToken, bnbIn, tokenOut, minOut);
    }

    /// @dev Converts bnbIn to a minimum acceptable bStock output using: Chainlink BNB/USD
    /// (an independent, off-chain-aggregated price, not a single AMM pool) to get the USD
    /// value of the BNB leg, then the bStock/USDT TWAP (same accumulator pattern as
    /// sellRsvd) to convert that USD value into an expected bStock amount, minus
    /// maxSlippageBps. Does NOT re-checkpoint the bStock TWAP automatically — call
    /// updateBStockTwapCheckpoint separately (rate-limiting buyReserveAsset per-asset the
    /// same way sellRsvd is rate-limited would otherwise block routine multi-asset
    /// rebalancing in a single cycle).
    function _bStockMinOutFloor(address bStock, address pairAddr, uint256 bnbIn) internal view returns (uint256) {
        (uint256 avgPriceX112, , ) = _twapSinceCheckpoint(pairAddr, bStock);

        (, int256 answer, , , ) = IChainlinkFeedLike(priceFeed).latestRoundData();
        if (answer <= 0) revert InvalidPriceFeed();
        uint8 feedDecimals = IChainlinkFeedLike(priceFeed).decimals();

        // USD value of the BNB leg, normalized to 18 decimals (USDT's decimals, asserted
        // at config time) — assumes USDT ~= $1, the standard stablecoin simplification.
        uint256 usdValueOfBnbIn = (bnbIn * uint256(answer)) / (10 ** feedDecimals);

        // avgPriceX112 is USDT-per-bStock in UQ112x112; dividing the (scaled) USD value by
        // it gives the bStock amount, scaled back down by the same 2^112.
        uint256 twapMinOut = (usdValueOfBnbIn << 112) / avgPriceX112;
        return (twapMinOut * (10_000 - maxSlippageBps)) / 10_000;
    }

    /// @notice Forwards an allowlisted reserve asset this contract holds into the vault.
    function depositReserveAsset(address token, uint256 amount) external onlyKeeper nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!isAllowedReserveAsset[token]) revert AssetNotAllowed(token);
        IERC20(token).forceApprove(address(vault), amount);
        vault.depositAsset(token, amount);
        emit ReserveAssetDeposited(token, amount);
    }

    /// @notice Receives BNB from the router's swapExactTokensForETH* call in sellRsvd.
    receive() external payable {}

    // No withdraw/rescue/sweep function exists anywhere in this contract, for the owner or
    // anyone else. Value only ever moves via sellRsvd (bounded + TWAP-floor-checked),
    // buyReserveAsset (bounded + allowlisted + TWAP-floor-checked when configured), or
    // depositReserveAsset (forwards into the vault, never to a wallet) — the same shape of
    // guarantee as ReservedVault's own absence of an owner-withdraw function.
}
