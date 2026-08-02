import { ethers } from "hardhat";

// Deploys ReservedGovernanceVote and seeds it with the initial candidate list — the
// well-known blue chips that don't have a bStock yet, which is exactly what this vote
// exists to signal demand for. Run against an already-deployed ReservedToken (via
// deploy.ts). This contract never touches RSVD, the vault, or the treasury converter —
// it only reads RSVD's balanceOf to gate voting, so it's safe to deploy and iterate on
// independently of the rest of the launch.
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";

// Comma-separated SYMBOL:Name pairs. Defaults to the blue chips without a bStock yet as
// of this writing (see contracts/scripts/verify-launch-addresses.ts's research notes) —
// re-check against Binance's current bStock catalog before using these defaults, in
// case more have shipped since.
const CANDIDATES =
  process.env.CANDIDATES ||
  "MSFT:Microsoft,AMZN:Amazon,GOOGL:Alphabet,AAPL:Apple,META:Meta Platforms";

async function main() {
  if (!TOKEN_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS env var first.");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }
  console.log("Deployer:", deployer.address);

  const Vote = await ethers.getContractFactory("ReservedGovernanceVote");
  const vote: any = await Vote.deploy(TOKEN_ADDRESS, deployer.address);
  await vote.waitForDeployment();
  const voteAddress = await vote.getAddress();
  console.log("ReservedGovernanceVote deployed to:", voteAddress);

  for (const entry of CANDIDATES.split(",")) {
    const [symbol, name] = entry.trim().split(":");
    const tx = await vote.connect(deployer).addCandidate(symbol, name);
    await tx.wait();
    console.log(`Added candidate: ${symbol} (${name})`);
  }

  console.log("\nNext steps:");
  console.log(`- Set web/config/token.ts governanceVoteAddress to "${voteAddress}"`);
  console.log("- vote.setVoteThreshold(...) if 100,000 RSVD isn't the right bar");
  console.log("- vote.setCandidateActive(<id>, false) once a candidate actually ships as a real bStock");
  console.log("- vote.resetRound() to start a fresh round after that happens");
  console.log("- Move ownership to a real multisig/timelock before this is depended on for real signal");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
