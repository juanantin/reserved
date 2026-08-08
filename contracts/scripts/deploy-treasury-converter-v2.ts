import { ethers } from "hardhat";

// Deploys TreasuryConverterV2 and wires it in: sets it as ReservedToken.treasury (so tax
// revenue lands in a bounded contract instead of a wallet) and as ReservedVault.keeper (so
// it can call depositAsset() directly).
//
// V2 replaces V1's venue-specific buy leg with a generic executor — see the contract's
// header for why. The practical difference at deploy time: instead of configuring a
// bStock/USDT V2 pair per asset (which does not exist for real bStocks), you configure
//   1. which contracts the keeper may forward swap calldata to (SWAP_TARGETS), and
//   2. a Chainlink USD feed per asset, which is what the price floor is derived from.
//
// Run against an already-deployed ReservedToken + ReservedVault (deploy.ts) and a real
// PancakeSwap RSVD/BNB pair (create-pool.ts). Must be run by the current owner of both —
// if ownership has moved to a timelock, go through schedule()/execute() instead.
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "";
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || "";
const PAIR_ADDRESS = process.env.PAIR_ADDRESS || "";
const PANCAKE_ROUTER = process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024E";

// Chainlink BNB/USD on BSC mainnet. Verified live by verify-launch-addresses.ts.
const BNB_USD_FEED = process.env.BNB_USD_FEED || "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";

// Comma-separated contracts the keeper may forward swap calldata to. This is the
// containment boundary for arbitrary execution — keep it to venues you have actually
// inspected. Leave unset to configure manually afterwards.
//   SWAP_TARGETS=0xRouter1,0xRouter2
const SWAP_TARGETS = process.env.SWAP_TARGETS || "";

// Comma-separated SYMBOL:tokenAddress[:usdFeedAddress] entries. Without a feed the asset
// is allowlisted but unbuyable while requireOracleFloor stays on (the safe default) —
// which is deliberate: it fails closed rather than silently trusting the keeper's quote.
//   BSTOCKS=CRCLB:0x80f3...:0xFeed,NVDAB:0x02fc...
const BSTOCKS = process.env.BSTOCKS || "";

// Per-tx and rolling-window BNB spend caps. The window cap is the one that actually
// bounds a compromised keeper — a per-tx cap alone can be called in a loop. Size both
// against your real pool/treasury, not against the contract's conservative defaults.
const MAX_BNB_PER_TX = process.env.MAX_BNB_PER_TX || "0.2";
const MAX_BNB_PER_WINDOW = process.env.MAX_BNB_PER_WINDOW || "1";
const MAX_RSVD_SPEND_PER_TX = process.env.MAX_RSVD_SPEND_PER_TX || "";

const NATIVE = "0x0000000000000000000000000000000000000000";

async function main() {
  if (!TOKEN_ADDRESS || !VAULT_ADDRESS || !PAIR_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS, VAULT_ADDRESS, and PAIR_ADDRESS env vars first.");
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured — check contracts/.env.");
  }
  console.log("Deployer:", deployer.address);

  const Converter = await ethers.getContractFactory("TreasuryConverterV2");
  const converter: any = await Converter.deploy(
    TOKEN_ADDRESS,
    VAULT_ADDRESS,
    PANCAKE_ROUTER,
    PAIR_ADDRESS,
    deployer.address, // owner — TODO: transfer to a multisig/timelock before real value flows
    deployer.address // keeper — TODO: replace with the keeper bot's operating address
  );
  await converter.waitForDeployment();
  const converterAddress = await converter.getAddress();
  console.log("TreasuryConverterV2 deployed to:", converterAddress);

  const token: any = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);
  const vault: any = await ethers.getContractAt("ReservedVault", VAULT_ADDRESS);

  await (await token.connect(deployer).setTreasury(converterAddress)).wait();
  console.log("token.treasury() -> converter (tax now lands in a bounded contract, not a wallet)");

  await (await vault.connect(deployer).setKeeper(converterAddress)).wait();
  console.log("vault.keeper() -> converter (can now call depositAsset directly)");

  await (await converter.updateTwapCheckpoint()).wait();
  console.log("Initial RSVD/BNB TWAP checkpoint recorded.");

  // --- Spend limits ---
  await (await converter.setMaxSpendPerTx(NATIVE, ethers.parseEther(MAX_BNB_PER_TX))).wait();
  console.log(`maxSpendPerTx[BNB] = ${MAX_BNB_PER_TX} BNB`);
  await (await converter.setMaxSpendPerWindow(NATIVE, ethers.parseEther(MAX_BNB_PER_WINDOW))).wait();
  console.log(`maxSpendPerWindow[BNB] = ${MAX_BNB_PER_WINDOW} BNB per ${await converter.spendWindowDuration()}s`);

  if (MAX_RSVD_SPEND_PER_TX) {
    await (await converter.setMaxRsvdSpendPerTx(ethers.parseUnits(MAX_RSVD_SPEND_PER_TX, 18))).wait();
    console.log(`maxRsvdSpendPerTx = ${MAX_RSVD_SPEND_PER_TX} RSVD`);
  }

  // --- Price feeds ---
  await (await converter.setAssetUsdFeed(NATIVE, BNB_USD_FEED)).wait();
  console.log("assetUsdFeed[BNB] =", BNB_USD_FEED);

  // --- Swap targets ---
  const targets = SWAP_TARGETS.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  for (const target of targets) {
    await (await converter.setAllowedTarget(target, true)).wait();
    console.log("allowed swap target:", target);
  }

  // --- Reserve assets ---
  const entries = BSTOCKS.split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const missingFeeds: string[] = [];
  for (const entry of entries) {
    const [symbol, address, feed] = entry.split(":");
    await (await converter.setAllowedReserveAsset(address, true)).wait();
    console.log(`allowed reserve asset: ${symbol} (${address})`);
    if (feed) {
      await (await converter.setAssetUsdFeed(address, feed)).wait();
      console.log(`  assetUsdFeed[${symbol}] = ${feed}`);
    } else {
      missingFeeds.push(symbol);
    }
  }

  console.log("\nNext steps:");
  if (targets.length === 0) {
    console.log("- setAllowedTarget(<router/aggregator>, true) — no swap target is allowlisted yet, so");
    console.log("  acquireReserveAsset cannot execute at all. This is the containment boundary for");
    console.log("  arbitrary calldata; only add venues you have actually inspected.");
  }
  if (missingFeeds.length > 0) {
    console.log(`- setAssetUsdFeed(...) for ${missingFeeds.join(", ")} — allowlisted but currently unbuyable,`);
    console.log("  because requireOracleFloor is on and no independent price source is configured.");
    console.log("  Do NOT reach for setRequireOracleFloor(false) to work around this: that removes the");
    console.log("  only on-chain protection against a bad quote, leaving price entirely to the keeper.");
  }
  console.log("- setKeeper(<keeper bot address>) once it exists — currently the deployer");
  console.log("- Move ownership of token/vault/converter to a multisig/timelock before real value flows");
  console.log(`- Wait at least minTwapWindow (${await converter.minTwapWindow()}s) before the first sellRsvd()`);
  console.log("- Verify on BscScan: npx hardhat verify --network bscMainnet " + converterAddress);
  console.log(
    `    "${TOKEN_ADDRESS}" "${VAULT_ADDRESS}" "${PANCAKE_ROUTER}" "${PAIR_ADDRESS}" "${deployer.address}" "${deployer.address}"`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
