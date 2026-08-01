// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

/// @title TreasuryConverter
/// @notice Set as ReservedToken.treasury so tax revenue lands here instead of a wallet.
/// The keeper can trigger conversions (RSVD -> BNB -> bStock -> vault deposit), but every
/// path value can leave through is bounded — there is deliberately no withdraw/rescue
/// function of any kind, for the owner or anyone else. A compromised keeper key can only
/// trigger capped, price-checked, pre-allowlisted purchases into the vault; it cannot
/// extract value. This is the same guarantee backed.is's vault gives ("no owner or keeper
/// path to withdraw stocks or ETH") — see PROJECT_BRIEF.md and contracts/README.md.
///
/// @dev sellRsvd's price floor is a genuine, manipulation-resistant TWAP computed from the
/// RSVD/BNB pair's own cumulative-price accumulator (the standard UniswapV2 oracle
/// pattern) — not the spot price, which a compromised/malicious keeper (or anyone who can
/// get a keeper-authorized call included) could otherwise manipulate via a single sandwich
/// transaction. buyReserveAsset (BNB -> bStock) has weaker protection: there is no
/// reliable, manipulation-resistant on-chain price reference for arbitrary bStock/BNB
/// pairs without integrating a real oracle per asset, which has not been built. That leg
/// is bounded only by the per-tx spend cap, the allowlist, and real-balance-delta
/// accounting — treat it as trusting the keeper more than sellRsvd does, and prioritize a
/// real price feed there before meaningful value flows through it.
contract TreasuryConverter is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ReservedToken public immutable rsvd;
    IReservedVaultLike public immutable vault;
    address public immutable WBNB;

    IPancakeRouterLike public router;
    address public rsvdBnbPair;
    address public keeper;

    /// @notice Per-call caps — bound the blast radius of a compromised keeper key.
    uint256 public maxRsvdSpendPerTx = 5_000_000 ether;
    uint256 public maxBnbSpendPerTx = 5 ether;

    /// @notice Max allowed slippage below the TWAP price for sellRsvd, in bps.
    uint256 public maxSlippageBps = 300; // 3%
    uint256 public constant MAX_SLIPPAGE_BPS_CAP = 1000; // 10% hard ceiling, like ReservedToken's tax cap

    /// @notice Minimum elapsed time between TWAP checkpoints. Also rate-limits sellRsvd —
    /// it can't be called more often than this, since it consumes and resets the checkpoint.
    uint256 public minTwapWindow = 10 minutes;

    uint256 public twapCheckpointCumulative;
    uint32 public twapCheckpointTimestamp;

    mapping(address => bool) public isAllowedReserveAsset;

    event KeeperUpdated(address indexed previousKeeper, address indexed newKeeper);
    event RouterUpdated(address indexed router);
    event RsvdBnbPairUpdated(address indexed pair);
    event MaxRsvdSpendPerTxUpdated(uint256 value);
    event MaxBnbSpendPerTxUpdated(uint256 value);
    event MaxSlippageBpsUpdated(uint256 value);
    event MinTwapWindowUpdated(uint256 value);
    event AllowedReserveAssetUpdated(address indexed token, bool allowed);
    event TwapCheckpointUpdated(uint256 cumulative, uint32 timestamp);
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
    // TWAP checkpoint
    // ---------------------------------------------------------------------

    /// @notice Records the current RSVD/BNB cumulative price. Callable by anyone — there's
    /// nothing to exploit by recording a fresh checkpoint, it only ever narrows the window
    /// sellRsvd will later measure. Must be called once after deployment before sellRsvd
    /// can be used; sellRsvd re-checkpoints automatically on every successful call.
    function updateTwapCheckpoint() public {
        (uint256 cumulative, uint32 timestamp) = _currentRsvdPerBnbCumulative();
        twapCheckpointCumulative = cumulative;
        twapCheckpointTimestamp = timestamp;
        emit TwapCheckpointUpdated(cumulative, timestamp);
    }

    function _currentRsvdPerBnbCumulative() internal view returns (uint256 cumulative, uint32 timestamp) {
        IUniswapV2PairLike p = IUniswapV2PairLike(rsvdBnbPair);
        address token0 = p.token0();
        (, , uint32 blockTimestampLast) = p.getReserves();
        // Price of RSVD in terms of BNB: if RSVD is token0, that's price0Cumulative
        // (price0 = reserve1/reserve0 = BNB/RSVD); if RSVD is token1, it's the other one.
        cumulative = (token0 == address(rsvd)) ? p.price0CumulativeLast() : p.price1CumulativeLast();
        timestamp = blockTimestampLast;
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
        if (twapCheckpointTimestamp == 0) revert TwapNotInitialized();

        (uint256 nowCumulative, uint32 nowTimestamp) = _currentRsvdPerBnbCumulative();

        uint32 elapsed;
        uint256 cumulativeDelta;
        unchecked {
            // UniswapV2's cumulative price and block timestamp are both designed to wrap
            // (overflow) over long enough periods; subtracting with wraparound arithmetic
            // still recovers the correct delta as long as less than a full wrap has
            // occurred since the last checkpoint, which holds here since every successful
            // sellRsvd re-checkpoints. This mirrors Uniswap's own reference oracle pattern.
            elapsed = nowTimestamp - twapCheckpointTimestamp;
            cumulativeDelta = nowCumulative - twapCheckpointCumulative;
        }
        if (elapsed == 0 || elapsed < minTwapWindow) revert TwapWindowNotElapsed();

        // UQ112x112 average price of RSVD in BNB over the window.
        uint256 avgPriceX112 = cumulativeDelta / elapsed;
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
        twapCheckpointCumulative = nowCumulative;
        twapCheckpointTimestamp = nowTimestamp;
        emit TwapCheckpointUpdated(nowCumulative, nowTimestamp);
        emit RsvdSold(amountIn, bnbOut, minOut);
    }

    /// @notice Buys `targetToken` (a bStock, must be pre-allowlisted) with up to
    /// maxBnbSpendPerTx of this contract's BNB. `path` must start at WBNB and end at
    /// targetToken. See the contract-level @dev note: this leg has no price-floor check,
    /// only the allowlist, the spend cap, and real-balance-delta accounting.
    function buyReserveAsset(
        uint256 bnbIn,
        uint256 minOut,
        address targetToken,
        address[] calldata path
    ) external onlyKeeper nonReentrant returns (uint256 tokenOut) {
        if (bnbIn == 0) revert ZeroAmount();
        if (bnbIn > maxBnbSpendPerTx) revert ExceedsMaxSpend();
        if (bnbIn > address(this).balance) revert ExceedsMaxSpend();
        if (!isAllowedReserveAsset[targetToken]) revert AssetNotAllowed(targetToken);
        if (path.length < 2 || path[0] != WBNB || path[path.length - 1] != targetToken) revert InvalidPath();

        uint256 tokenBefore = IERC20(targetToken).balanceOf(address(this));
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: bnbIn}(minOut, path, address(this), block.timestamp);
        tokenOut = IERC20(targetToken).balanceOf(address(this)) - tokenBefore;
        if (tokenOut < minOut) revert BelowMinOut(tokenOut, minOut);

        emit ReserveAssetBought(targetToken, bnbIn, tokenOut, minOut);
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
    // buyReserveAsset (bounded + allowlisted), or depositReserveAsset (forwards into the
    // vault, never to a wallet) — the same shape of guarantee as ReservedVault's own
    // absence of an owner-withdraw function.
}
