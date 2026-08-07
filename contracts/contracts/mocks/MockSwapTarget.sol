// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockSwapTarget
/// @notice Test-only stand-in for whatever venue TreasuryConverterV2's generic executor
/// forwards calldata to (an RFQ settlement contract, an aggregator router, an AMM router —
/// the contract under test deliberately can't tell the difference). Deliberately supports
/// misbehaving modes too, since the whole point of the executor's balance-delta checks is
/// to catch a target that under-delivers or over-pulls. Never deployed to a live network.
contract MockSwapTarget {
    /// @notice Pre-funded output inventory this mock pays out from.
    /// Fund it by transferring tokens in before calling.

    /// @notice Happy path, native-in: accepts BNB and pays out `amountOut` of `tokenOut`.
    function swapExactNative(address tokenOut, uint256 amountOut, address recipient) external payable {
        IERC20(tokenOut).transfer(recipient, amountOut);
    }

    /// @notice Happy path, ERC20-in: pulls `amountIn` of `tokenIn` via the allowance the
    /// executor granted, then pays out `amountOut` of `tokenOut`.
    function swapExactToken(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut,
        address recipient
    ) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, amountOut);
    }

    /// @notice Pulls more than the executor intended to spend, using whatever allowance
    /// exists. Exercises the OverspentBudget guard.
    function overpullToken(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut,
        address recipient
    ) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, amountOut);
    }

    /// @notice Takes payment and delivers nothing. Exercises the BelowMinOut guard.
    function swapAndUnderdeliver() external payable {}

    /// @notice Reverts outright, so the executor surfaces the failure rather than
    /// silently treating a failed swap as a zero-output success.
    function swapAndRevert() external payable {
        revert("MockSwapTarget: swap failed");
    }

    receive() external payable {}
}
