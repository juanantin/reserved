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

interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function WETH9() external view returns (address);

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint32 feeProtocol,
            bool unlocked
        );
    function observe(
        uint32[] calldata secondsAgos
    ) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function increaseObservationCardinalityNext(uint16 observationCardinalityNext) external;
}

interface IWBNBLike {
    function withdraw(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
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

/// @title TreasuryConverterV3
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
/// WHY V3 EXISTS — V2 kept the sell leg on a PancakeSwap V2 pair, reasoning that "that
/// pair is one this project creates and funds itself" and so could not go missing the way
/// the bStock pairs did. The reasoning was sound; the premise expired. The launch moved to
/// a Uniswap-style V3 pool, which has no getReserves and no price0CumulativeLast, so
/// setRsvdBnbPair could not be pointed at it and sellRsvd could never have executed. The
/// header above warns that binding to one market structure guarantees a later
/// rediscovery — this is that warning coming due on the one leg it exempted.
///
/// The sell leg is therefore rebuilt on V3, and its floor is expressed in TICKS rather
/// than a converted price. A V3 tick is one basis point (1.0001^1), so maxSlippageBps maps
/// onto ticks directly: "the pool's tick after this sale sits no more than maxSlippageBps
/// beyond the TWAP tick" is the same economic bound V2 enforced on price. That avoids
/// carrying getSqrtRatioAtTick, whose constant tables would have to be trusted blindly for
/// the one number the entire security model rests on.
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
contract TreasuryConverterV3 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

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

    // --- Sell leg (RSVD -> BNB), rebuilt on V3 ---
    ISwapRouterV3 public router;
    address public rsvdBnbPool;
    uint24 public rsvdBnbPoolFee;
    /// @notice Whether RSVD is the pool's token0. Derived from the pool, never supplied,
    /// because it decides which DIRECTION a sale pushes the tick — and therefore which way
    /// the floor comparison runs. Getting it backwards would invert the safety check.
    bool public rsvdIsToken0;
    uint256 public maxRsvdSpendPerTx = 5_000_000 ether;
    uint256 public minTwapWindow = 10 minutes;

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
    event RsvdBnbPoolUpdated(address indexed pool, uint24 fee, bool rsvdIsToken0);
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
    event ObservationCardinalityIncreased(address indexed pool, uint16 cardinality);
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
    error TwapUnavailable();
    error SellerNotTaxExempt();
    error BeyondTwapFloor(int24 tickAfter, int24 floorTick);
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
        address rsvdBnbPool_,
        uint24 rsvdBnbPoolFee_,
        address initialOwner_,
        address keeper_
    ) Ownable(initialOwner_) {
        if (
            rsvd_ == address(0) ||
            vault_ == address(0) ||
            router_ == address(0) ||
            rsvdBnbPool_ == address(0) ||
            keeper_ == address(0)
        ) revert ZeroAddress();

        rsvd = ReservedToken(rsvd_);
        vault = IReservedVaultLike(vault_);
        router = ISwapRouterV3(router_);
        WBNB = ISwapRouterV3(router_).WETH9();
        _setPool(rsvdBnbPool_, rsvdBnbPoolFee_, rsvd_);
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
        router = ISwapRouterV3(newRouter);
        emit RouterUpdated(newRouter);
    }

    function setRsvdBnbPool(address newPool, uint24 newFee) external onlyOwner {
        _setPool(newPool, newFee, address(rsvd));
    }

    /// @dev Reads token0 off the pool rather than accepting it, and refuses a pool that
    /// is not actually RSVD/WBNB — a mismatched pool would give a TWAP for some other
    /// pair, which the floor check would then enforce against RSVD.
    function _setPool(address pool, uint24 fee, address rsvdAddr) private {
        if (pool == address(0)) revert ZeroAddress();
        address t0 = IUniswapV3PoolLike(pool).token0();
        address t1 = IUniswapV3PoolLike(pool).token1();
        bool isToken0 = t0 == rsvdAddr;
        if (!isToken0 && t1 != rsvdAddr) revert ZeroAddress();
        if ((isToken0 ? t1 : t0) != WBNB) revert ZeroAddress();

        rsvdBnbPool = pool;
        rsvdBnbPoolFee = fee;
        rsvdIsToken0 = isToken0;
        emit RsvdBnbPoolUpdated(pool, fee, isToken0);
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
    // TWAP (sell leg only — the RSVD/WBNB pool is one we create and fund)
    // ---------------------------------------------------------------------

    /// @notice Grows the pool's observation ring so a `minTwapWindow` lookback becomes
    /// possible. A freshly created V3 pool stores exactly one observation, so observe()
    /// over any useful window reverts until this has been called AND enough time has
    /// passed for the ring to fill with real samples. Callable by anyone: more history
    /// can only ever make the floor harder to manipulate.
    function increaseObservationCardinality(uint16 cardinality) external {
        IUniswapV3PoolLike(rsvdBnbPool).increaseObservationCardinalityNext(cardinality);
        emit ObservationCardinalityIncreased(rsvdBnbPool, cardinality);
    }

    /// @notice Arithmetic-mean tick over the last `minTwapWindow` seconds.
    /// @dev V3 maintains its own observation ring, so unlike V2's accumulator this needs
    /// no checkpoint written by us and cannot be starved by nobody calling a poke
    /// function — which was a live availability risk in the V2 design.
    function twapTick() public view returns (int24) {
        uint32 window = uint32(minTwapWindow);
        if (window == 0) revert TwapWindowNotElapsed();

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;

        try IUniswapV3PoolLike(rsvdBnbPool).observe(secondsAgos) returns (
            int56[] memory tickCumulatives,
            uint160[] memory
        ) {
            int56 delta = tickCumulatives[1] - tickCumulatives[0];
            int24 avg = int24(delta / int56(uint56(window)));
            // Round toward negative infinity, as Uniswap's OracleLibrary does, so the
            // rounding never lands in the seller's favour.
            if (delta < 0 && (delta % int56(uint56(window)) != 0)) avg--;
            return avg;
        } catch {
            // The pool cannot serve a window this long yet: too few observations, or the
            // ring has not been growing for long enough.
            revert TwapUnavailable();
        }
    }

    // ---------------------------------------------------------------------
    // Sell leg — RSVD -> BNB, bounded by the pool's own TWAP tick
    // ---------------------------------------------------------------------

    /// @notice Sell RSVD for BNB through the project's own V3 pool.
    ///
    /// @dev The floor is a tick bound, not a converted price — see the contract header
    /// for why. Because the swap is routed through exactInputSingle at an explicit
    /// (tokenIn, tokenOut, fee), it MUST execute against this exact pool, which is what
    /// makes the post-swap tick a meaningful measure of what was paid: price moves
    /// monotonically through a single-pool swap, so bounding the end tick bounds the
    /// average fill. A keeper routing elsewhere to get a bad price cannot: there is
    /// nowhere else for this call to go.
    ///
    /// The direction matters. Selling RSVD pushes the tick DOWN when RSVD is token0 and
    /// UP when it is token1, so the comparison flips with rsvdIsToken0.
    function sellRsvd(uint256 amountIn, uint256 keeperMinOut) external onlyKeeper nonReentrant returns (uint256 bnbOut) {
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > maxRsvdSpendPerTx) revert ExceedsMaxSpend();
        // V3 has no fee-on-transfer swap variant. If this contract ever lost its tax
        // exemption the pool would receive less RSVD than the router accounted for and
        // the swap would fail deep inside the callback. Fail here, legibly, instead.
        if (!rsvd.isTaxExempt(address(this))) revert SellerNotTaxExempt();

        int24 referenceTick = twapTick();
        int24 bound = int24(uint24(maxSlippageBps));
        int24 floorTick = rsvdIsToken0 ? referenceTick - bound : referenceTick + bound;

        uint256 bnbBefore = address(this).balance;
        IERC20(address(rsvd)).forceApprove(address(router), amountIn);
        router.exactInputSingle(
            ISwapRouterV3.ExactInputSingleParams({
                tokenIn: address(rsvd),
                tokenOut: WBNB,
                fee: rsvdBnbPoolFee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: keeperMinOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(address(rsvd)).forceApprove(address(router), 0);

        // The router pays out WBNB; unwrap so the buy leg keeps spending native BNB
        // exactly as it did under V2.
        uint256 wrapped = IWBNBLike(WBNB).balanceOf(address(this));
        if (wrapped > 0) IWBNBLike(WBNB).withdraw(wrapped);
        bnbOut = address(this).balance - bnbBefore;
        if (bnbOut < keeperMinOut) revert BelowMinOut(bnbOut, keeperMinOut);

        (, int24 tickAfter, , , , , ) = IUniswapV3PoolLike(rsvdBnbPool).slot0();
        bool beyond = rsvdIsToken0 ? tickAfter < floorTick : tickAfter > floorTick;
        if (beyond) revert BeyondTwapFloor(tickAfter, floorTick);

        emit RsvdSold(amountIn, bnbOut, keeperMinOut);
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

    /// @notice Receives BNB from unwrapping WBNB in sellRsvd, and from swap venues
    /// returning unspent native value.
    receive() external payable {}
}
