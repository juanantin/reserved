// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
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

/// @title TreasuryConverterV2
/// @notice Set as ReservedToken.treasury so tax revenue lands here instead of a wallet.
/// Converts accrued RSVD into reserve assets (bStocks) held by ReservedVault.
///
/// @dev WHY V2 EXISTS — the venue assumption in V1 was wrong, and wrong in a way that
/// couldn't be patched with a new address. V1's buy leg derived its price floor from the
/// *venue it was trading on*: it read a PancakeSwap V2 pair's own cumulative-price
/// accumulator for the target bStock. Verified against real BSC mainnet, no such pair
/// exists — not for any of CRCLB/NVDAB/SNDKB/MUB/AMDB, on V2 or V3, against USDT or WBNB.
/// Those tokens (BEP-8056, "custodial model") settle through signed off-chain RFQ quotes
/// against the issuer's own vault, with only the stablecoin leg touching a public pool.
///
/// The structural lesson isn't "support RFQ too" — it's that binding a treasury contract
/// to one market structure guarantees another rediscovery later. So the buy leg here is
/// deliberately venue-agnostic: it forwards opaque calldata to an owner-allowlisted target
/// and judges the result purely by observed balance deltas plus an *independent* oracle
/// floor. RFQ, V2, V3, Infinity, or whatever ships next all work with zero contract
/// changes; only the allowlist moves.
///
/// What did NOT need rework: the RSVD -> BNB sell leg still checks the RSVD/WBNB V2 pair's
/// own accumulator, because that pair is one this project creates and funds itself. That
/// mechanism was always sound and is carried over unchanged.
///
/// SECURITY MODEL — what a compromised keeper key can and cannot do:
///  - CANNOT withdraw anything to itself or any wallet. Acquired assets are deposited into
///    the vault atomically, in the same transaction as the swap.
///  - CANNOT sell RSVD below the TWAP floor (sellRsvd), nor route RSVD through the generic
///    executor (spendToken == rsvd is rejected, so the TWAP floor can't be sidestepped).
///  - CANNOT call arbitrary contracts — only owner-allowlisted targets, and never the RSVD
///    token, the vault, or this contract itself.
///  - CANNOT drain by repetition: spending is bounded per-transaction AND by a rolling
///    cumulative window per spend token (V1 had only a per-tx cap, which a compromised key
///    could simply call in a loop within one block).
///  - CANNOT accept an arbitrarily bad quote where an oracle feed is configured: the
///    contract computes its own floor from Chainlink feeds and takes the stricter of that
///    and the keeper's minAcquired.
///  - CAN choose execution timing and venue within those bounds. Where no oracle feed is
///    configured for an asset, price quality on that asset rests on the keeper's own
///    off-chain quote — see requireOracleFloor, which defaults to fail-closed.
///
/// ON THE ESCAPE HATCH — V1 had no withdraw path of any kind, which reads well but created
/// a real hazard: BNB from sellRsvd could only ever leave via the buy leg, so the venue
/// mismatch above would have permanently bricked every BNB the keeper converted. V2 keeps
/// "no path to a wallet" (the invariant that actually matters) while removing the
/// permanent-lockup failure mode: funds may be migrated only to a *contract*, only by the
/// owner, only after a 7-day timelock, and only with the destination announced on-chain in
/// advance. There is no function on this contract that can move value to an EOA.
contract TreasuryConverterV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct TwapCheckpoint {
        uint256 cumulative;
        uint32 timestamp;
    }

    /// @notice Rolling cumulative spend limiter. `windowStart` advances in whole windows,
    /// so a quiet period doesn't bank unused allowance beyond the current window.
    struct SpendWindow {
        uint256 spent;
        uint256 windowStart;
    }

    ReservedToken public immutable rsvd;
    IReservedVaultLike public immutable vault;
    address public immutable WBNB;

    /// @notice Sentinel for native BNB in the per-token spend-limit and price-feed maps.
    address public constant NATIVE = address(0);

    // --- Sell leg (RSVD -> BNB), carried over from V1 unchanged ---
    IPancakeRouterLike public router;
    address public rsvdBnbPair;
    uint256 public maxRsvdSpendPerTx = 5_000_000 ether;
    uint256 public minTwapWindow = 10 minutes;
    mapping(address => TwapCheckpoint) public twapCheckpoints;

    // --- Buy leg (generic executor) ---
    address public keeper;
    mapping(address => bool) public isAllowedReserveAsset;
    /// @notice Contracts the keeper may forward swap calldata to. Deliberately narrow —
    /// this is the primary containment boundary for arbitrary-calldata execution.
    mapping(address => bool) public isAllowedTarget;
    /// @notice Per-transaction spend cap, keyed by spend token (NATIVE for BNB).
    mapping(address => uint256) public maxSpendPerTx;
    /// @notice Rolling-window cumulative spend cap, keyed by spend token. Zero disables
    /// the window check for that token (per-tx cap still applies).
    mapping(address => uint256) public maxSpendPerWindow;
    mapping(address => SpendWindow) public spendWindows;
    uint256 public spendWindowDuration = 1 days;

    // --- Independent price floor ---
    /// @notice Chainlink USD feed per token; assetUsdFeed[NATIVE] is the BNB/USD feed.
    /// Both the spend side and the acquire side need one for a floor to be computable.
    mapping(address => address) public assetUsdFeed;
    /// @notice Reject feed answers older than this. V1 never checked staleness at all —
    /// a frozen feed there would have been trusted indefinitely.
    uint256 public maxOracleAge = 1 hours;
    /// @notice When true (default), acquireReserveAsset reverts for any asset lacking a
    /// usable oracle floor rather than silently falling back to trusting the keeper's
    /// minAcquired. Turning this off is a deliberate, logged decision.
    bool public requireOracleFloor = true;

    uint256 public maxSlippageBps = 300; // 3%
    uint256 public constant MAX_SLIPPAGE_BPS_CAP = 1000; // 10% hard ceiling

    // --- Migration escape hatch ---
    uint256 public constant MIGRATION_DELAY = 7 days;
    address public pendingMigrationTarget;
    uint256 public migrationEta;

    event KeeperUpdated(address indexed previousKeeper, address indexed newKeeper);
    event RouterUpdated(address indexed router);
    event RsvdBnbPairUpdated(address indexed pair);
    event AllowedReserveAssetUpdated(address indexed token, bool allowed);
    event AllowedTargetUpdated(address indexed target, bool allowed);
    event MaxSpendPerTxUpdated(address indexed token, uint256 value);
    event MaxSpendPerWindowUpdated(address indexed token, uint256 value);
    event SpendWindowDurationUpdated(uint256 value);
    event AssetUsdFeedUpdated(address indexed token, address indexed feed);
    event MaxOracleAgeUpdated(uint256 value);
    event RequireOracleFloorUpdated(bool value);
    event MaxSlippageBpsUpdated(uint256 value);
    event MaxRsvdSpendPerTxUpdated(uint256 value);
    event MinTwapWindowUpdated(uint256 value);
    event TwapCheckpointUpdated(address indexed subject, uint256 cumulative, uint32 timestamp);
    event RsvdSold(uint256 amountIn, uint256 bnbOut, uint256 minOut);
    event ReserveAssetAcquired(
        address indexed token,
        address indexed target,
        address spendToken,
        uint256 spent,
        uint256 acquired,
        uint256 minAcquired
    );
    event ReserveAssetDeposited(address indexed token, uint256 amount);
    event MigrationScheduled(address indexed target, uint256 eta);
    event MigrationCancelled(address indexed target);
    event MigrationExecuted(address indexed target, uint256 bnbAmount);

    error ZeroAddress();
    error ZeroAmount();
    error NotKeeper();
    error ExceedsMaxSpend();
    error ExceedsWindowSpend();
    error SlippageTooHigh(uint256 requested, uint256 max);
    error TwapWindowNotElapsed();
    error TwapNotInitialized();
    error AssetNotAllowed(address token);
    error TargetNotAllowed(address target);
    error ForbiddenTarget(address target);
    error ForbiddenSpendToken(address token);
    error BelowMinOut(uint256 actual, uint256 required);
    error UnsupportedDecimals(address token, uint8 decimals);
    error OracleFloorNotConfigured(address token);
    error InvalidPriceFeed();
    error StalePriceFeed(uint256 age, uint256 maxAge);
    error OverspentBudget(uint256 spent, uint256 allowed);
    error NotAContract(address target);
    error NoMigrationScheduled();
    error MigrationNotReady(uint256 nowTs, uint256 eta);

    modifier onlyKeeper() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(
        address rsvd_,
        address vault_,
        address router_,
        address rsvdBnbPair_,
        address initialOwner_,
        address keeper_
    ) Ownable(initialOwner_) {
        if (
            rsvd_ == address(0) ||
            vault_ == address(0) ||
            router_ == address(0) ||
            rsvdBnbPair_ == address(0) ||
            keeper_ == address(0)
        ) revert ZeroAddress();

        rsvd = ReservedToken(rsvd_);
        vault = IReservedVaultLike(vault_);
        router = IPancakeRouterLike(router_);
        rsvdBnbPair = rsvdBnbPair_;
        WBNB = IPancakeRouterLike(router_).WETH();
        keeper = keeper_;
        emit KeeperUpdated(address(0), keeper_);
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

    /// @notice Allowlist a bStock the keeper may acquire. Asserts 18 decimals, which the
    /// oracle-floor math below assumes rather than trusts.
    function setAllowedReserveAsset(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (allowed) {
            uint8 dec = IERC20Metadata(token).decimals();
            if (dec != 18) revert UnsupportedDecimals(token, dec);
        }
        isAllowedReserveAsset[token] = allowed;
        emit AllowedReserveAssetUpdated(token, allowed);
    }

    /// @notice Allowlist a router/aggregator the keeper may forward calldata to. This is
    /// the containment boundary for arbitrary execution — keep it minimal, and never add
    /// a token contract, the vault, or an address you don't fully understand.
    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        if (target == address(rsvd) || target == address(vault) || target == address(this)) {
            revert ForbiddenTarget(target);
        }
        if (allowed && target.code.length == 0) revert NotAContract(target);
        isAllowedTarget[target] = allowed;
        emit AllowedTargetUpdated(target, allowed);
    }

    function setMaxSpendPerTx(address token, uint256 value) external onlyOwner {
        maxSpendPerTx[token] = value;
        emit MaxSpendPerTxUpdated(token, value);
    }

    function setMaxSpendPerWindow(address token, uint256 value) external onlyOwner {
        maxSpendPerWindow[token] = value;
        emit MaxSpendPerWindowUpdated(token, value);
    }

    function setSpendWindowDuration(uint256 value) external onlyOwner {
        if (value == 0) revert ZeroAmount();
        spendWindowDuration = value;
        emit SpendWindowDurationUpdated(value);
    }

    /// @notice Set (or clear, with address(0)) the Chainlink USD feed for `token`. Use
    /// NATIVE (address(0)) as the token key for the BNB/USD feed.
    function setAssetUsdFeed(address token, address feed) external onlyOwner {
        assetUsdFeed[token] = feed;
        emit AssetUsdFeedUpdated(token, feed);
    }

    function setMaxOracleAge(uint256 value) external onlyOwner {
        if (value == 0) revert ZeroAmount();
        maxOracleAge = value;
        emit MaxOracleAgeUpdated(value);
    }

    function setRequireOracleFloor(bool value) external onlyOwner {
        requireOracleFloor = value;
        emit RequireOracleFloorUpdated(value);
    }

    function setMaxSlippageBps(uint256 value) external onlyOwner {
        if (value > MAX_SLIPPAGE_BPS_CAP) revert SlippageTooHigh(value, MAX_SLIPPAGE_BPS_CAP);
        maxSlippageBps = value;
        emit MaxSlippageBpsUpdated(value);
    }

    function setMaxRsvdSpendPerTx(uint256 value) external onlyOwner {
        maxRsvdSpendPerTx = value;
        emit MaxRsvdSpendPerTxUpdated(value);
    }

    function setMinTwapWindow(uint256 value) external onlyOwner {
        minTwapWindow = value;
        emit MinTwapWindowUpdated(value);
    }

    // ---------------------------------------------------------------------
    // TWAP checkpoints (sell leg only — the RSVD/WBNB pair is one we create)
    // ---------------------------------------------------------------------

    /// @notice Records the current RSVD/BNB cumulative price. Callable by anyone: recording
    /// a fresh checkpoint only ever narrows the window sellRsvd later measures.
    function updateTwapCheckpoint() public {
        (uint256 cumulative, uint32 timestamp) = _currentCumulative(rsvdBnbPair, address(rsvd));
        twapCheckpoints[address(rsvd)] = TwapCheckpoint(cumulative, timestamp);
        emit TwapCheckpointUpdated(address(rsvd), cumulative, timestamp);
    }

    function _currentCumulative(
        address pairAddr,
        address subject
    ) internal view returns (uint256 cumulative, uint32 timestamp) {
        IUniswapV2PairLike p = IUniswapV2PairLike(pairAddr);
        address token0 = p.token0();
        (, , uint32 blockTimestampLast) = p.getReserves();
        cumulative = (token0 == subject) ? p.price0CumulativeLast() : p.price1CumulativeLast();
        timestamp = blockTimestampLast;
    }

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
            // UniswapV2's cumulative price and block timestamp are both designed to wrap;
            // wraparound subtraction still recovers the correct delta as long as less than
            // a full wrap has elapsed, which holds since every consumer re-checkpoints.
            elapsed = nowTimestamp - cp.timestamp;
            cumulativeDelta = nowCumulative - cp.cumulative;
        }
        if (elapsed == 0 || elapsed < minTwapWindow) revert TwapWindowNotElapsed();

        avgPriceX112 = cumulativeDelta / elapsed;
    }

    // ---------------------------------------------------------------------
    // Sell leg — RSVD -> BNB, bounded by the RSVD/WBNB pair's own TWAP
    // ---------------------------------------------------------------------

    function sellRsvd(uint256 amountIn, uint256 keeperMinOut) external onlyKeeper nonReentrant returns (uint256 bnbOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > maxRsvdSpendPerTx) revert ExceedsMaxSpend();

        (uint256 avgPriceX112, uint256 nowCumulative, uint32 nowTimestamp) = _twapSinceCheckpoint(
            rsvdBnbPair,
            address(rsvd)
        );

        uint256 twapMinOut = (amountIn * avgPriceX112) >> 112;
        uint256 floorMinOut = (twapMinOut * (10_000 - maxSlippageBps)) / 10_000;
        uint256 minOut = keeperMinOut > floorMinOut ? keeperMinOut : floorMinOut;

        address[] memory path = new address[](2);
        path[0] = address(rsvd);
        path[1] = WBNB;

        uint256 bnbBefore = address(this).balance;
        IERC20(address(rsvd)).forceApprove(address(router), amountIn);
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(amountIn, minOut, path, address(this), block.timestamp);
        IERC20(address(rsvd)).forceApprove(address(router), 0);
        bnbOut = address(this).balance - bnbBefore;
        if (bnbOut < minOut) revert BelowMinOut(bnbOut, minOut);

        // Re-checkpoint so the next call prices off a fresh window, and so this can't be
        // called again until minTwapWindow has passed.
        twapCheckpoints[address(rsvd)] = TwapCheckpoint(nowCumulative, nowTimestamp);
        emit TwapCheckpointUpdated(address(rsvd), nowCumulative, nowTimestamp);
        emit RsvdSold(amountIn, bnbOut, minOut);
    }

    // ---------------------------------------------------------------------
    // Buy leg — venue-agnostic executor
    // ---------------------------------------------------------------------

    /// @notice Acquire an allowlisted reserve asset by forwarding `callData` to an
    /// allowlisted `target`, then deposit the proceeds into the vault atomically.
    ///
    /// @dev The contract intentionally does not model the venue. It enforces: the target
    /// and asset are allowlisted, the spend is within both the per-tx and rolling-window
    /// caps, at most `spendAmount` actually left, at least `minAcquired` actually arrived,
    /// and — where feeds exist — that `minAcquired` is no worse than an independently
    /// computed oracle floor. Everything the target does internally is irrelevant so long
    /// as those hold.
    ///
    /// @param spendToken NATIVE (address(0)) for BNB, or an ERC20 this contract holds.
    ///        Never RSVD: routing RSVD through here would bypass sellRsvd's TWAP floor.
    /// @param minAcquired Keeper's own floor. The stricter of this and the oracle floor wins.
    function acquireReserveAsset(
        address spendToken,
        uint256 spendAmount,
        address target,
        bytes calldata callData,
        address acquireToken,
        uint256 minAcquired
    ) external onlyKeeper nonReentrant returns (uint256 acquired) {
        _validateAcquisition(spendToken, spendAmount, target, acquireToken, minAcquired);
        _consumeSpendWindow(spendToken, spendAmount);

        // The stricter of the keeper's own floor and the contract's independent one.
        {
            uint256 oracleFloor = _oracleFloor(spendToken, spendAmount, acquireToken);
            if (oracleFloor > minAcquired) minAcquired = oracleFloor;
        }

        uint256 acquiredBefore = IERC20(acquireToken).balanceOf(address(this));
        uint256 spent;
        // Scoped so the before/after balances don't stay live on the stack afterwards.
        {
            uint256 spentBefore = _selfBalance(spendToken);
            _forwardToTarget(spendToken, spendAmount, target, callData);
            uint256 spentAfter = _selfBalance(spendToken);
            // The target could in principle pull more than intended (e.g. via a
            // pre-existing allowance); verify what actually left rather than assuming.
            spent = spentBefore > spentAfter ? spentBefore - spentAfter : 0;
            if (spent > spendAmount) revert OverspentBudget(spent, spendAmount);
        }

        acquired = IERC20(acquireToken).balanceOf(address(this)) - acquiredBefore;
        if (acquired < minAcquired) revert BelowMinOut(acquired, minAcquired);

        // Deposit atomically: the asset never sits in this contract between transactions.
        _depositToVault(acquireToken, acquired);

        emit ReserveAssetAcquired(acquireToken, target, spendToken, spent, acquired, minAcquired);
    }

    function _validateAcquisition(
        address spendToken,
        uint256 spendAmount,
        address target,
        address acquireToken,
        uint256 minAcquired
    ) internal view {
        if (spendAmount == 0 || minAcquired == 0) revert ZeroAmount();
        if (spendToken == address(rsvd)) revert ForbiddenSpendToken(spendToken);
        if (spendToken == acquireToken) revert ForbiddenSpendToken(spendToken);
        if (!isAllowedReserveAsset[acquireToken]) revert AssetNotAllowed(acquireToken);
        if (!isAllowedTarget[target]) revert TargetNotAllowed(target);
        // Defence in depth: these can never be allowlisted (setAllowedTarget rejects them),
        // but re-check in case an earlier allowlisting predates that guard.
        if (target == address(rsvd) || target == address(vault) || target == address(this)) {
            revert ForbiddenTarget(target);
        }

        uint256 perTxCap = maxSpendPerTx[spendToken];
        if (perTxCap == 0 || spendAmount > perTxCap) revert ExceedsMaxSpend();
        if (spendToken == NATIVE && spendAmount > address(this).balance) revert ExceedsMaxSpend();
    }

    function _forwardToTarget(address spendToken, uint256 spendAmount, address target, bytes calldata callData) internal {
        if (spendToken == NATIVE) {
            Address.functionCallWithValue(target, callData, spendAmount);
        } else {
            IERC20(spendToken).forceApprove(target, spendAmount);
            Address.functionCall(target, callData);
            // Revoke immediately — never leave a standing allowance to a swap venue.
            IERC20(spendToken).forceApprove(target, 0);
        }
    }

    function _depositToVault(address token, uint256 amount) internal {
        IERC20(token).forceApprove(address(vault), amount);
        vault.depositAsset(token, amount);
        IERC20(token).forceApprove(address(vault), 0);
    }

    /// @notice Forward an allowlisted reserve asset this contract already holds into the
    /// vault. Covers assets acquired outside the executor (e.g. bought manually by the
    /// owner and transferred in) — the vault is still the only possible destination.
    function depositReserveAsset(address token, uint256 amount) external onlyKeeper nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!isAllowedReserveAsset[token]) revert AssetNotAllowed(token);
        _depositToVault(token, amount);
        emit ReserveAssetDeposited(token, amount);
    }

    function _selfBalance(address token) internal view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    /// @dev Advances the rolling window if the previous one has fully elapsed, then charges
    /// `amount` against the current window's allowance.
    function _consumeSpendWindow(address token, uint256 amount) internal {
        uint256 cap = maxSpendPerWindow[token];
        if (cap == 0) return; // window limiting disabled for this token

        SpendWindow storage w = spendWindows[token];
        if (block.timestamp >= w.windowStart + spendWindowDuration) {
            w.windowStart = block.timestamp;
            w.spent = 0;
        }
        uint256 newSpent = w.spent + amount;
        if (newSpent > cap) revert ExceedsWindowSpend();
        w.spent = newSpent;
    }

    /// @notice Remaining spend allowance for `token` in the current rolling window.
    function remainingWindowAllowance(address token) external view returns (uint256) {
        uint256 cap = maxSpendPerWindow[token];
        if (cap == 0) return type(uint256).max;
        SpendWindow memory w = spendWindows[token];
        if (block.timestamp >= w.windowStart + spendWindowDuration) return cap;
        return w.spent >= cap ? 0 : cap - w.spent;
    }

    /// @dev Minimum acceptable output derived from Chainlink USD feeds on both sides —
    /// deliberately independent of the venue the trade executes on, which is the whole
    /// point: a venue can't vouch for its own price. Returns 0 when no floor is computable,
    /// which the caller treats per `requireOracleFloor`.
    function _oracleFloor(
        address spendToken,
        uint256 spendAmount,
        address acquireToken
    ) internal view returns (uint256) {
        address spendFeed = assetUsdFeed[spendToken];
        address acquireFeed = assetUsdFeed[acquireToken];

        if (spendFeed == address(0) || acquireFeed == address(0)) {
            if (requireOracleFloor) revert OracleFloorNotConfigured(acquireToken);
            return 0;
        }

        uint256 spendUsd18 = _usdPrice18(spendFeed);
        uint256 acquireUsd18 = _usdPrice18(acquireFeed);

        // Both sides are 18-decimal (asserted for reserve assets at allowlist time; native
        // BNB is 18 by definition), so the decimals cancel and this is a clean ratio.
        uint256 expectedOut = (spendAmount * spendUsd18) / acquireUsd18;
        return (expectedOut * (10_000 - maxSlippageBps)) / 10_000;
    }

    /// @dev Chainlink answer normalised to 18 decimals, rejecting non-positive or stale
    /// answers. V1 read `answer` without ever checking `updatedAt`.
    function _usdPrice18(address feed) internal view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = IChainlinkFeedLike(feed).latestRoundData();
        if (answer <= 0) revert InvalidPriceFeed();
        if (updatedAt == 0) revert InvalidPriceFeed();
        uint256 age = block.timestamp > updatedAt ? block.timestamp - updatedAt : 0;
        if (age > maxOracleAge) revert StalePriceFeed(age, maxOracleAge);

        uint8 feedDecimals = IChainlinkFeedLike(feed).decimals();
        if (feedDecimals > 18) revert InvalidPriceFeed();
        return uint256(answer) * (10 ** (18 - feedDecimals));
    }

    /// @notice Preview the oracle-derived floor without executing. Useful for the keeper to
    /// sanity-check a quote off-chain before spending gas.
    function previewOracleFloor(
        address spendToken,
        uint256 spendAmount,
        address acquireToken
    ) external view returns (uint256) {
        return _oracleFloor(spendToken, spendAmount, acquireToken);
    }

    // ---------------------------------------------------------------------
    // Migration escape hatch — contract destinations only, after a public delay
    // ---------------------------------------------------------------------

    /// @notice Announce an intended migration target. Cannot execute for MIGRATION_DELAY,
    /// giving holders a full week to see the event and react before anything moves.
    function scheduleMigration(address newConverter) external onlyOwner {
        if (newConverter == address(0)) revert ZeroAddress();
        if (newConverter.code.length == 0) revert NotAContract(newConverter);
        if (newConverter == address(this)) revert ForbiddenTarget(newConverter);
        pendingMigrationTarget = newConverter;
        migrationEta = block.timestamp + MIGRATION_DELAY;
        emit MigrationScheduled(newConverter, migrationEta);
    }

    function cancelMigration() external onlyOwner {
        emit MigrationCancelled(pendingMigrationTarget);
        pendingMigrationTarget = address(0);
        migrationEta = 0;
    }

    /// @notice Move BNB and the listed tokens to the scheduled successor contract. The
    /// destination is re-validated as a contract at execution time, so this can never
    /// resolve to a wallet.
    function executeMigration(address[] calldata tokens) external onlyOwner nonReentrant {
        address target = pendingMigrationTarget;
        if (target == address(0)) revert NoMigrationScheduled();
        if (block.timestamp < migrationEta) revert MigrationNotReady(block.timestamp, migrationEta);
        if (target.code.length == 0) revert NotAContract(target);

        pendingMigrationTarget = address(0);
        migrationEta = 0;

        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 bal = IERC20(tokens[i]).balanceOf(address(this));
            if (bal > 0) IERC20(tokens[i]).safeTransfer(target, bal);
        }

        uint256 bnbBal = address(this).balance;
        if (bnbBal > 0) Address.sendValue(payable(target), bnbBal);

        emit MigrationExecuted(target, bnbBal);
    }

    /// @notice Receives BNB from the router's swapExactTokensForETH* call in sellRsvd, and
    /// from swap venues returning unspent native value.
    receive() external payable {}
}
