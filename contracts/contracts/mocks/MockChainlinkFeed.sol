// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockChainlinkFeed
/// @notice Test-only stand-in for a Chainlink AggregatorV3Interface-style price feed, with
/// directly settable answer/decimals so TreasuryConverter's buyReserveAsset price floor can
/// be tested against known values. Never deployed to a real network.
contract MockChainlinkFeed {
    int256 public answer;
    uint8 public decimals_;

    /// @notice Fixed `updatedAt` to report, for exercising TreasuryConverterV2's staleness
    /// check. Zero (the default) means "report block.timestamp", i.e. always fresh — which
    /// keeps every pre-existing test that never touches this behaving exactly as before.
    uint256 public updatedAtOverride;

    constructor(int256 answer_, uint8 decimals__) {
        answer = answer_;
        decimals_ = decimals__;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAtOverride = updatedAt_;
    }

    function decimals() external view returns (uint8) {
        return decimals_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint256 ts = updatedAtOverride == 0 ? block.timestamp : updatedAtOverride;
        return (1, answer, ts, ts, 1);
    }
}
