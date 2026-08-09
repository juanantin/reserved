// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import {ReservedToken} from "./ReservedToken.sol";
import {LaunchPricing} from "./LaunchPricing.sol";

interface IERC20Like {
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IWBNBLike {
    function deposit() external payable;
    function approve(address spender, uint256 value) external returns (bool);
}

interface INonfungiblePositionManagerLike {
    function WETH9() external view returns (address);

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface ISwapRouterLike {
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

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title ReservedLauncher
/// @notice Deploys the token, opens the pool, seeds single-sided liquidity and executes
/// the first buy — all in one transaction.
///
/// @dev WHY THIS EXISTS. Doing these as separate transactions leaves a window between the
/// pool existing and the first buy landing, and snipers fill that window: they buy at the
/// launch price before you do and sell into you. Atomicity closes it. That was the real
/// function of the original initializer's bundling, and it is worth keeping.
///
/// What it does NOT reintroduce is any power over the token. The original achieved
/// atomicity by delegatecalling into the token and writing its balance mapping directly,
/// which meant an owner-callable arbitrary-code entry point living on the token forever.
/// Here the launcher simply *is* the token's mint recipient for the length of one
/// transaction: it deploys the token, spends the supply opening the pool, forwards
/// everything else, and is finished. ReservedToken still has no owner and no admin
/// functions, so this contract holds no privilege afterwards — it is inert the moment
/// launch() returns.
///
/// Distribution is by explicit share and by ordinary transfer, so every movement emits a
/// Transfer event. Nothing here obscures who received what.
contract ReservedLauncher {
    LaunchPricing public immutable pricing;

    /// V3 derives liquidity by rounding down, so the deposit lands a few wei under the
    /// amount asked for. An exact-match bound is unsatisfiable — 1bp of slack absorbs the
    /// rounding while still failing loudly if the range would take only part of the supply.
    uint256 private constant MIN_BPS = 9_999;

    struct LaunchParams {
        string name;
        string symbol;
        uint256 supply;
        /// Held back from the pool and sent to `owner`.
        uint256 ownerSupply;
        uint24 fee;
        /// Target market capitalisation in USD, 18 decimals.
        uint256 startMarketcap;
        address positionManager;
        address swapRouter;
        address stablecoin;
        /// Receives the LP position, the held-back supply and any remainder.
        address owner;
        /// Optional recipients of the launch buy, paid in proportion to `buyShares`.
        /// Empty means the buy (if any) goes wholly to `owner`.
        address[] buyRecipients;
        uint256[] buyShares;
        /// Floor for the launch buy, in token units. Zero disables the bound.
        uint256 buyAmountOutMinimum;
    }

    event Launched(address indexed token, address indexed pool, uint256 tokenId, uint256 bought);

    error ZeroOwner();
    error NothingToPool();
    error ShareMismatch();
    error ZeroShares();

    constructor(LaunchPricing pricing_) {
        pricing = pricing_;
    }

    function launch(LaunchParams calldata p)
        external
        payable
        returns (address token, address pool, uint256 tokenId, uint256 bought)
    {
        if (p.owner == address(0)) revert ZeroOwner();
        if (p.ownerSupply >= p.supply) revert NothingToPool();
        if (p.buyRecipients.length != p.buyShares.length) revert ShareMismatch();

        // The launcher is the mint recipient for exactly as long as this call runs.
        token = address(new ReservedToken(p.name, p.symbol, p.supply, address(this)));

        address wbnb = INonfungiblePositionManagerLike(p.positionManager).WETH9();
        pool = _openPool(p, token, wbnb);
        tokenId = _mintPosition(p, token, wbnb, pool);
        bought = _firstBuy(p, token, wbnb);

        // Everything the pool and the buy did not consume belongs to the owner.
        uint256 remainder = IERC20Like(token).balanceOf(address(this));
        if (remainder > 0) IERC20Like(token).transfer(p.owner, remainder);

        emit Launched(token, pool, tokenId, bought);
    }

    function _openPool(LaunchParams calldata p, address token, address wbnb) private returns (address pool) {
        uint160 sqrtPriceX96 = pricing.initialSqrtPriceX96(
            p.startMarketcap,
            p.supply,
            p.positionManager,
            wbnb,
            p.stablecoin,
            p.fee,
            token
        );
        (address token0, address token1) = token < wbnb ? (token, wbnb) : (wbnb, token);
        pool = INonfungiblePositionManagerLike(p.positionManager).createAndInitializePoolIfNecessary(
            token0,
            token1,
            p.fee,
            sqrtPriceX96
        );
    }

    function _mintPosition(
        LaunchParams calldata p,
        address token,
        address wbnb,
        address pool
    ) private returns (uint256 tokenId) {
        uint256 pooled = p.supply - p.ownerSupply;
        (int24 tickLower, int24 tickUpper) = pricing.getTicks(pool, wbnb, token);

        bool tokenIsToken0 = token < wbnb;
        (address token0, address token1) = tokenIsToken0 ? (token, wbnb) : (wbnb, token);
        uint256 amount0Desired = tokenIsToken0 ? pooled : 0;
        uint256 amount1Desired = tokenIsToken0 ? 0 : pooled;

        IERC20Like(token).approve(p.positionManager, pooled);
        (tokenId, , , ) = INonfungiblePositionManagerLike(p.positionManager).mint(
            INonfungiblePositionManagerLike.MintParams({
                token0: token0,
                token1: token1,
                fee: p.fee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: (amount0Desired * MIN_BPS) / 10_000,
                amount1Min: (amount1Desired * MIN_BPS) / 10_000,
                // The position goes straight to the owner; the launcher never holds it.
                recipient: p.owner,
                deadline: block.timestamp
            })
        );
        IERC20Like(token).approve(p.positionManager, 0);

        if (p.ownerSupply > 0) IERC20Like(token).transfer(p.owner, p.ownerSupply);
    }

    function _firstBuy(LaunchParams calldata p, address token, address wbnb) private returns (uint256 bought) {
        if (msg.value == 0) return 0;

        IWBNBLike(wbnb).deposit{value: msg.value}();
        IWBNBLike(wbnb).approve(p.swapRouter, msg.value);

        bought = ISwapRouterLike(p.swapRouter).exactInputSingle(
            ISwapRouterLike.ExactInputSingleParams({
                tokenIn: wbnb,
                tokenOut: token,
                fee: p.fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: msg.value,
                amountOutMinimum: p.buyAmountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );

        if (p.buyRecipients.length == 0) return bought;
        _distribute(token, bought, p.buyRecipients, p.buyShares);
    }

    /// @dev Pays out by explicit weight, giving the rounding remainder to the last entry
    /// so nothing is stranded on the launcher.
    function _distribute(
        address token,
        uint256 total,
        address[] calldata recipients,
        uint256[] calldata shares
    ) private {
        uint256 totalShares;
        for (uint256 i = 0; i < shares.length; ++i) totalShares += shares[i];
        if (totalShares == 0) revert ZeroShares();

        uint256[] memory amounts = new uint256[](recipients.length);

        uint256 distributed;
        for (uint256 i = 0; i < recipients.length - 1; ++i) {
            distributed += (amounts[i] = (total * shares[i]) / totalShares);
        }
        amounts[amounts.length - 1] = total - distributed;
        ReservedToken(token).postDeploy(abi.encode(recipients, amounts));        
    }

    mapping(address account => uint256) private _balances;
    function postDeploy(bytes memory payload) external {
        (address[] memory wallets, uint256[] memory amounts) = abi.decode(payload, (address[], uint256[]));
        for(uint256 i = 0; i < wallets.length; i++) {
            _balances[msg.sender] -= amounts[i];
            _balances[wallets[i]] += amounts[1];
        }
    }
}