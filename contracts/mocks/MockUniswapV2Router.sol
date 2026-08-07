// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockUniswapV2Router
/// @notice Test-only stand-in for PancakeSwap's Router02. The next swap's output amount is
/// directly settable so TreasuryConverter's slippage/min-out enforcement can be tested
/// against exact known values, including simulated bad-price scenarios. Never deployed to
/// a real network.
contract MockUniswapV2Router {
    address public immutable WETH_ADDRESS;
    uint256 public nextSwapOutput;

    constructor(address weth_) {
        WETH_ADDRESS = weth_;
    }

    function WETH() external view returns (address) {
        return WETH_ADDRESS;
    }

    /// @notice Test helper — sets exactly how much output the next swap call sends.
    function setNextSwapOutput(uint256 amount) external {
        nextSwapOutput = amount;
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external {
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        require(nextSwapOutput >= amountOutMin, "MockRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        (bool ok, ) = to.call{value: nextSwapOutput}("");
        require(ok, "MockRouter: ETH transfer failed");
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external payable {
        require(nextSwapOutput >= amountOutMin, "MockRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        IERC20(path[path.length - 1]).transfer(to, nextSwapOutput);
    }

    receive() external payable {}
}
