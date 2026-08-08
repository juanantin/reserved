// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockUniswapV2Pair
/// @notice Test-only stand-in for a UniswapV2/PancakeSwap pair, with directly settable
/// reserves and cumulative prices so TreasuryConverter's TWAP logic can be tested against
/// known values (including simulated price manipulation) without a full local DEX
/// deployment or a mainnet fork. Never deployed to a real network.
contract MockUniswapV2Pair {
    address public token0;
    address public token1;
    uint112 public reserve0;
    uint112 public reserve1;
    uint32 public blockTimestampLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function setReserves(uint112 reserve0_, uint112 reserve1_, uint32 blockTimestampLast_) external {
        reserve0 = reserve0_;
        reserve1 = reserve1_;
        blockTimestampLast = blockTimestampLast_;
    }

    function setCumulativePrices(uint256 price0Cumulative_, uint256 price1Cumulative_) external {
        price0CumulativeLast = price0Cumulative_;
        price1CumulativeLast = price1Cumulative_;
    }
}
