const { expect } = require("chai");
const { ethers } = require("hardhat");

const FIXED_SUPPLY = ethers.parseUnits("1000000000", 18);
const THRESHOLD = ethers.parseUnits("100000", 18);

async function deploySystem() {
  const [owner, holder, smallHolder, other] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ReservedToken");
  const token = await Token.deploy("Reserved", "RSVD", FIXED_SUPPLY, owner.address, owner.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const Vote = await ethers.getContractFactory("ReservedGovernanceVote");
  const vote = await Vote.deploy(tokenAddress, owner.address);
  await vote.waitForDeployment();
  const voteAddress = await vote.getAddress();

  // holder clears the vote threshold; smallHolder deliberately doesn't.
  await token.connect(owner).transfer(holder.address, THRESHOLD);
  await token.connect(owner).transfer(smallHolder.address, THRESHOLD - 1n);

  return { token, vote, owner, holder, smallHolder, other, tokenAddress, voteAddress };
}

describe("ReservedGovernanceVote", function () {
  describe("access control", function () {
    it("rejects a zero address RSVD token in the constructor", async function () {
      const { owner } = await deploySystem();
      const Vote = await ethers.getContractFactory("ReservedGovernanceVote");
      await expect(Vote.deploy(ethers.ZeroAddress, owner.address)).to.be.revertedWithCustomError(Vote, "ZeroAddress");
    });

    it("only the owner can add candidates, set active state, set threshold, or reset the round", async function () {
      const { vote, other } = await deploySystem();
      await expect(vote.connect(other).addCandidate("MSFT", "Microsoft")).to.be.revertedWithCustomError(
        vote,
        "OwnableUnauthorizedAccount"
      );
      await expect(vote.connect(other).setCandidateActive(0, false)).to.be.revertedWithCustomError(
        vote,
        "OwnableUnauthorizedAccount"
      );
      await expect(vote.connect(other).setVoteThreshold(1)).to.be.revertedWithCustomError(vote, "OwnableUnauthorizedAccount");
      await expect(vote.connect(other).resetRound()).to.be.revertedWithCustomError(vote, "OwnableUnauthorizedAccount");
    });
  });

  describe("castVote", function () {
    it("reverts for a below-threshold balance", async function () {
      const { vote, owner, smallHolder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await expect(vote.connect(smallHolder).castVote(0)).to.be.revertedWithCustomError(vote, "BelowVoteThreshold");
    });

    it("reverts for a nonexistent candidate", async function () {
      const { vote, holder } = await deploySystem();
      await expect(vote.connect(holder).castVote(0)).to.be.revertedWithCustomError(vote, "InvalidCandidate");
    });

    it("reverts for a deactivated candidate", async function () {
      const { vote, owner, holder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await vote.connect(owner).setCandidateActive(0, false);
      await expect(vote.connect(holder).castVote(0)).to.be.revertedWithCustomError(vote, "CandidateInactive");
    });

    it("lets an eligible holder vote, and reports it via myVote and getVoteCounts", async function () {
      const { vote, owner, holder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await vote.connect(owner).addCandidate("AMZN", "Amazon");

      await expect(vote.connect(holder).castVote(1))
        .to.emit(vote, "VoteCast")
        .withArgs(0, holder.address, 1);

      const [hasVoted, candidateId] = await vote.myVote(holder.address);
      expect(hasVoted).to.equal(true);
      expect(candidateId).to.equal(1);

      const counts = await vote.getVoteCounts();
      expect(counts[0]).to.equal(0);
      expect(counts[1]).to.equal(1);
    });

    it("moves the vote (decrements the old count) when a holder revotes for a different candidate", async function () {
      const { vote, owner, holder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await vote.connect(owner).addCandidate("AMZN", "Amazon");

      await vote.connect(holder).castVote(0);
      await vote.connect(holder).castVote(1);

      const counts = await vote.getVoteCounts();
      expect(counts[0]).to.equal(0);
      expect(counts[1]).to.equal(1);

      const [, candidateId] = await vote.myVote(holder.address);
      expect(candidateId).to.equal(1);
    });

    it("does not double count when a holder votes for the same candidate twice", async function () {
      const { vote, owner, holder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");

      await vote.connect(holder).castVote(0);
      await vote.connect(holder).castVote(0);

      const counts = await vote.getVoteCounts();
      expect(counts[0]).to.equal(1);
    });

    it("counts multiple distinct voters for the same candidate", async function () {
      const { token, vote, owner, holder } = await deploySystem();
      const [, , , other] = await ethers.getSigners();
      await token.connect(owner).transfer(other.address, THRESHOLD);
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");

      await vote.connect(holder).castVote(0);
      await vote.connect(other).castVote(0);

      const counts = await vote.getVoteCounts();
      expect(counts[0]).to.equal(2);
    });
  });

  describe("resetRound", function () {
    it("clears prior votes from the tally and myVote without touching candidates", async function () {
      const { vote, owner, holder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await vote.connect(holder).castVote(0);

      await expect(vote.connect(owner).resetRound()).to.emit(vote, "RoundReset").withArgs(1);

      const counts = await vote.getVoteCounts();
      expect(counts[0]).to.equal(0);
      const [hasVoted] = await vote.myVote(holder.address);
      expect(hasVoted).to.equal(false);
      expect(await vote.candidateCount()).to.equal(1);
    });

    it("lets a holder vote again in the new round", async function () {
      const { vote, owner, holder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await vote.connect(holder).castVote(0);
      await vote.connect(owner).resetRound();

      await vote.connect(holder).castVote(0);
      const counts = await vote.getVoteCounts();
      expect(counts[0]).to.equal(1);
    });
  });

  describe("setVoteThreshold", function () {
    it("changes what balance is required to vote", async function () {
      const { vote, owner, smallHolder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await vote.connect(owner).setVoteThreshold(1);
      await expect(vote.connect(smallHolder).castVote(0)).to.not.be.reverted;
    });
  });

  describe("setCandidateActive", function () {
    it("lets a candidate be reactivated after being deactivated", async function () {
      const { vote, owner, holder } = await deploySystem();
      await vote.connect(owner).addCandidate("MSFT", "Microsoft");
      await vote.connect(owner).setCandidateActive(0, false);
      await vote.connect(owner).setCandidateActive(0, true);
      await expect(vote.connect(holder).castVote(0)).to.not.be.reverted;
    });

    it("reverts for an out-of-range candidateId", async function () {
      const { vote, owner } = await deploySystem();
      await expect(vote.connect(owner).setCandidateActive(0, true)).to.be.revertedWithCustomError(vote, "InvalidCandidate");
    });
  });
});
