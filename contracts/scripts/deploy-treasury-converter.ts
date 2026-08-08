import { ethers } from "hardhat";

// Deploys TreasuryConverter and wires it in: sets it as ReservedToken.treasury (so tax
// revenue lands in a bounded contract instead of a wallet) and as ReservedVault.keeper
// (so it can call depositAsset() directly — see TreasuryConverter.test.js for why).
//
// Run against an already-deployed ReservedToken + ReservedVault (via deploy.ts) and a
// real PancakeSwap RSVD/BNB pair (via create-pool.ts). Must be run by the current owner
// of both contracts — if ownership has moved to a timelock, do this through
// schedule()/execute() instead.
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";
const PAIR_ADDRESS = process.env.PAIR_ADDRESS || "";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "0x55d398326f99059fF775485246999027B3197955"; // BSC mainnet USDT (18 decimals)
const PANCAKE_ROUTER = process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024E";

// Optional — the contract's built-in defaults (5,000,000 RSVD / 5 BNB per tx) assume a
// pool with real depth behind it. For a small/fresh launch pool those caps can exceed
// the entire pool, which defeats the point of a "per-tx cap" (see PROJECT_BRIEF.md /
// the launch-sizing discussion). Set these to something proportionate to your actual
// pool size and this script will right-size them right after deploy; leave unset to
// keep the contract's defaults.
const MAX_BNB_SPEND_PER_TX = process.env.MAX_BNB_SPEND_PER_TX || ""; // e.g. "0.2"
const MAX_RSVD_SPEND_PER_TX = process.env.MAX_RSVD_SPEND_PER_TX || ""; // e.g. "5000000"

async function main() {
  if (!TOKEN_ADDRESS || !VAULT_ADDRESS || !PAIR_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS, VAULT_ADDRESS, and PAIR_ADDRESS env vars first.");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }
  console.log("Deployer:", deployer.address);

  const Converter = await ethers.getContractFactory("TreasuryConverter");
  const converter: any = await Converter.deploy(
    TOKEN_ADDRESS,
    VAULT_ADDRESS,
    PANCAKE_ROUTER,
    PAIR_ADDRESS,
    USDT_ADDRESS,
    deployer.address, // owner — TODO: transfer to a real multisig/timelock before real value flows through this
    deployer.address // keeper — TODO: replace with the real keeper bot's operating address
  );
  await converter.waitForDeployment();
  const converterAddress = await converter.getAddress();
  console.log("TreasuryConverter deployed to:", converterAddress);

  const token: any = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);
  const vault: any = await ethers.getContractAt("ReservedVault", VAULT_ADDRESS);

  await (await token.connect(deployer).setTreasury(converterAddress)).wait();
  console.log("token.treasury() set to TreasuryConverter — tax revenue now lands in a bounded contract, not a wallet.");

  await (await vault.connect(deployer).setKeeper(converterAddress)).wait();
  console.log("vault.keeper() set to TreasuryConverter — it can now call depositAsset() directly.");

  await (await converter.updateTwapCheckpoint()).wait();
  console.log("Initial TWAP checkpoint recorded.");

  if (MAX_BNB_SPEND_PER_TX) {
    await (await converter.connect(deployer).setMaxBnbSpendPerTx(ethers.parseEther(MAX_BNB_SPEND_PER_TX))).wait();
    console.log(`maxBnbSpendPerTx set to ${MAX_BNB_SPEND_PER_TX} BNB.`);
  }
  if (MAX_RSVD_SPEND_PER_TX) {
    await (await converter.connect(deployer).setMaxRsvdSpendPerTx(ethers.parseUnits(MAX_RSVD_SPEND_PER_TX, 18))).wait();
    console.log(`maxRsvdSpendPerTx set to ${MAX_RSVD_SPEND_PER_TX} RSVD.`);
  }

  console.log("\nNext steps:");
  console.log("- converter.setAllowedReserveAsset(<bStock address>, true) for each real bStock the keeper will buy");
  console.log("- converter.setPriceFeed(<Chainlink BNB/USD feed address>) — required for buyReserveAsset's price floor");
  console.log("- converter.setBStockUsdtPair(<bStock address>, <bStock/USDT pair address>) for each allowlisted bStock");
  console.log("  (buyReserveAsset reverts with PriceFloorNotConfigured for any asset missing this + the price feed,");
  console.log("   unless setRequirePriceFloorForBuys(false) is deliberately called first — not recommended)");
  console.log("- converter.updateBStockTwapCheckpoint(<bStock address>) once per bStock, then wait minTwapWindow before buying it");
  console.log("- converter.setKeeper(<real keeper bot address>) once it exists — currently the deployer");
  console.log("- Move ownership of token/vault/converter to a real multisig/timelock before real value flows through");
  console.log(`- Wait at least minTwapWindow (${await converter.minTwapWindow()}s) after the checkpoint above before the first sellRsvd()`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
