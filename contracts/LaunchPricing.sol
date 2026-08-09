// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

interface INonfungiblePositionManagerLike {
    function factory() external view returns (address);
}

interface IUniswapV3FactoryLike {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3PoolLike {
    function tickSpacing() external view returns (int24);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            // uint32, not uint8: PancakeSwap V3 packs feeProtocol0 | (feeProtocol1 << 16),
            // and BSC's WBNB/USDT 0.25% pool reads 209718400. A uint8 here makes the ABI
            // decoder reject the word and reverts the whole launch.
            uint32 feeProtocol,
            bool unlocked
        );
}

/// @title LaunchPricing
/// @notice Pure pricing helpers for opening a single-sided V3 position at a target market
/// cap. Stateless, permissionless, view-only — it holds nothing, owns nothing and can
/// change nothing.
///
/// @dev This is the arithmetic from the original UniswapV3TokenInitializer, kept
/// deliberately verbatim. It was verified against BSC mainnet: launching RSVDTST at a
/// $10,000 target produced a pool implying $9,999.87, inside one basis point, in both
/// token orderings. Reimplementing it in TypeScript would have thrown that evidence away,
/// so only the surrounding delivery mechanism changed.
///
/// What was dropped from the original was never pricing: an owner-only arbitrary
/// delegatecall entry point, direct writes to the token's balance mapping, and a routine
/// that split a launch buy across derived wallets. Opening the position is now an ordinary
/// script calling the position manager, so none of that is needed — the token mints its
/// supply in its own constructor and a launcher just reads the numbers below.
contract LaunchPricing {
    int24 private constant MIN_TICK = -887272;
    int24 private constant MAX_TICK = -MIN_TICK;

    /// @notice sqrtPriceX96 to initialise a `token`/`nativeToken` pool such that
    /// `totalSupply` of `token` is worth `startMarketcap`, priced through the
    /// native/stablecoin pool at the same fee tier.
    /// @param startMarketcap Target market capitalisation, 18 decimals (USD).
    /// @param totalSupply Full token supply in wei — the cap is priced off all of it, not
    /// just the portion being pooled.
    function initialSqrtPriceX96(
        uint256 startMarketcap,
        uint256 totalSupply,
        address positionManager,
        address nativeToken,
        address stablecoin,
        uint24 fee,
        address token
    ) external view returns (uint160 sqrtPriceX96) {
        address referencePool = IUniswapV3FactoryLike(
            INonfungiblePositionManagerLike(positionManager).factory()
        ).getPool(nativeToken, stablecoin, fee);
        require(referencePool != address(0), "no reference pool at this fee tier");

        (sqrtPriceX96, , , , , , ) = IUniswapV3PoolLike(referencePool).slot0();
        sqrtPriceX96 = _priceToSqrt(
            _failsafeDivision(
                _failsafeDivision(startMarketcap, 1e18, totalSupply),
                1e18,
                _sqrtToPrice(sqrtPriceX96, stablecoin, nativeToken)
            ),
            nativeToken,
            token
        );
    }

    /// @notice The single-sided tick range to open, holding only `token`.
    /// @dev Rounding the current tick toward zero puts tickLower at or above spot, which
    /// is what keeps the position one-sided — a range straddling spot would demand the
    /// native token too. The cost is a gap of up to one tick spacing between the price the
    /// pool is initialised at and where liquidity actually begins.
    function getTicks(
        address pool,
        address nativeToken,
        address token
    ) external view returns (int24 tickLower, int24 tickUpper) {
        bool isToken0 = token < nativeToken;
        (, int24 currentTick, , , , , ) = IUniswapV3PoolLike(pool).slot0();
        int24 tickSpacing = IUniswapV3PoolLike(pool).tickSpacing();
        currentTick -= (currentTick % tickSpacing);
        tickLower = isToken0 ? currentTick : (MIN_TICK - (MIN_TICK % tickSpacing));
        tickUpper = isToken0 ? (MAX_TICK - (MAX_TICK % tickSpacing)) : (currentTick - tickSpacing);
    }

    function _sqrtToPrice(uint160 sqrtPriceX96, address nominator, address denominator) private pure returns (uint256) {
        uint256 price = _failsafeDivision(
            _failsafeDivision(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 0x1000000000000000000000000),
            1e18,
            2 ** 96
        );
        return nominator == (nominator < denominator ? nominator : denominator) ? _failsafeDivision(1e36, 1, price) : price;
    }

    function _priceToSqrt(uint256 price, address referenceTokenAddress, address otherTokenAddress) private pure returns (uint160) {
        uint256 p = referenceTokenAddress < otherTokenAddress ? _failsafeDivision(1e36, 1, price) : price;
        return uint160(_failsafeDivision(_sqrt(p), 0x1000000000000000000000000, 1e9));
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }

    /// @dev Full-width mulDiv: computes a * b / denominator with the intermediate product
    /// held across two words, so it does not overflow at Q96 scale.
    function _failsafeDivision(uint256 a, uint256 b, uint256 denominator) private pure returns (uint256 result) {
        uint256 prod0;
        uint256 prod1;
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }

        if (prod1 == 0) {
            require(denominator > 0);
            assembly {
                result := div(prod0, denominator)
            }
            return result;
        }

        require(denominator > prod1);

        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, denominator)
        }
        assembly {
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }

        uint256 twos = denominator & (~denominator + 1);
        assembly {
            denominator := div(denominator, twos)
        }
        assembly {
            prod0 := div(prod0, twos)
        }
        assembly {
            twos := add(div(sub(0, twos), twos), 1)
        }
        prod0 |= prod1 * twos;

        uint256 inv = (3 * denominator) ^ 2;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;

        result = prod0 * inv;
        return result;
    }
}
