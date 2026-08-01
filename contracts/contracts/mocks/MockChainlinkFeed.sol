// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockChainlinkFeed
/// @notice Test-only stand-in for a Chainlink AggregatorV3Interface-style price feed, with
/// directly settable answer/decimals so TreasuryConverter's buyReserveAsset price floor can
/// be tested against known values. Never deployed to a real network.
contract MockChainlinkFeed {
    int256 public answer;
    uint8 public decimals_;

    constructor(int256 answer_, uint8 decimals__) {
        answer = answer_;
        decimals_ = decimals__;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
    }

    function decimals() external view returns (uint8) {
        return decimals_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}
