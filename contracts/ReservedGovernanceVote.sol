// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ReservedGovernanceVote
/// @notice Non-binding signaling: RSVD holders vote on which bStock the reserve should
/// prioritize acquiring next, once it becomes available. This contract has no access to
/// RSVD, the vault, or the treasury converter — it only reads RSVD's balanceOf to gate
/// who can vote. A compromised owner key here can add/remove candidates and change the
/// vote threshold, but cannot touch anyone's funds or the reserve.
/// @dev Votes are grouped by `currentRound`, incremented by the owner (e.g. once a
/// winning candidate actually ships as a real bStock and gets allowlisted on the
/// converter) rather than clearing every voter's stored choice individually, which
/// would be unbounded-cost for a large voter set.
contract ReservedGovernanceVote is Ownable2Step {
    IERC20 public immutable rsvd;

    /// @notice Minimum RSVD balance required to cast a vote, checked at vote time (not
    /// locked/staked — holders keep full custody and control of their tokens).
    uint256 public voteThreshold = 100_000 ether;

    struct Candidate {
        string symbol;
        string name;
        bool active;
    }

    Candidate[] public candidates;

    uint256 public currentRound;

    /// @dev round => candidateId => vote count.
    mapping(uint256 => mapping(uint256 => uint256)) public voteCounts;

    /// @dev round => voter => candidateId + 1 (0 means "hasn't voted this round").
    mapping(uint256 => mapping(address => uint256)) private voterChoicePlusOne;

    event CandidateAdded(uint256 indexed candidateId, string symbol, string name);
    event CandidateActiveSet(uint256 indexed candidateId, bool active);
    event VoteThresholdUpdated(uint256 value);
    event RoundReset(uint256 indexed newRound);
    event VoteCast(uint256 indexed round, address indexed voter, uint256 indexed candidateId);

    error ZeroAddress();
    error InvalidCandidate();
    error CandidateInactive();
    error BelowVoteThreshold(uint256 balance, uint256 required);

    constructor(address rsvd_, address initialOwner_) Ownable(initialOwner_) {
        if (rsvd_ == address(0)) revert ZeroAddress();
        rsvd = IERC20(rsvd_);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function addCandidate(string calldata symbol, string calldata name) external onlyOwner returns (uint256 candidateId) {
        candidates.push(Candidate(symbol, name, true));
        candidateId = candidates.length - 1;
        emit CandidateAdded(candidateId, symbol, name);
    }

    /// @notice Deactivates (or reactivates) a candidate — e.g. once it ships as a real
    /// bStock and is no longer something to vote *for*. Existing votes for it are left
    /// alone (still counted in getVoteCounts for that round); only new votes are blocked.
    function setCandidateActive(uint256 candidateId, bool active) external onlyOwner {
        if (candidateId >= candidates.length) revert InvalidCandidate();
        candidates[candidateId].active = active;
        emit CandidateActiveSet(candidateId, active);
    }

    function setVoteThreshold(uint256 value) external onlyOwner {
        voteThreshold = value;
        emit VoteThresholdUpdated(value);
    }

    /// @notice Starts a fresh voting round — every vote count and per-voter choice from
    /// prior rounds stops counting, without needing to clear per-voter state
    /// individually (that would be unbounded-cost for a large voter set). Candidates
    /// themselves persist across rounds; deactivate the ones that shipped separately.
    function resetRound() external onlyOwner {
        currentRound++;
        emit RoundReset(currentRound);
    }

    // ---------------------------------------------------------------------
    // Voting
    // ---------------------------------------------------------------------

    /// @notice Casts (or changes) the caller's vote for the current round. Requires
    /// holding at least voteThreshold RSVD at the time of the call — checked by balance,
    /// not staked or locked. Calling again with a different candidateId moves the vote;
    /// the previous choice's count is decremented first.
    function castVote(uint256 candidateId) external {
        if (candidateId >= candidates.length) revert InvalidCandidate();
        if (!candidates[candidateId].active) revert CandidateInactive();

        uint256 balance = rsvd.balanceOf(msg.sender);
        if (balance < voteThreshold) revert BelowVoteThreshold(balance, voteThreshold);

        uint256 round = currentRound;
        uint256 previousChoicePlusOne = voterChoicePlusOne[round][msg.sender];
        if (previousChoicePlusOne != 0) {
            voteCounts[round][previousChoicePlusOne - 1]--;
        }
        voterChoicePlusOne[round][msg.sender] = candidateId + 1;
        voteCounts[round][candidateId]++;

        emit VoteCast(round, msg.sender, candidateId);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function candidateCount() external view returns (uint256) {
        return candidates.length;
    }

    function getVoteCounts() external view returns (uint256[] memory counts) {
        uint256 n = candidates.length;
        counts = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            counts[i] = voteCounts[currentRound][i];
        }
    }

    /// @notice Returns whether `voter` has voted in the current round and, if so, which
    /// candidateId. hasVoted is false (and candidateId meaningless) otherwise.
    function myVote(address voter) external view returns (bool hasVoted, uint256 candidateId) {
        uint256 choicePlusOne = voterChoicePlusOne[currentRound][voter];
        hasVoted = choicePlusOne != 0;
        candidateId = hasVoted ? choicePlusOne - 1 : 0;
    }
}
