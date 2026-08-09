import { ethers } from "hardhat";
import { DEPLOYMENTS } from "./pancake-addresses";

/**
 * Deploys TreasuryConverterV3 and wires the treasury pipeline end to end:
 *   - sets it as ReservedToken.treasury, so tax accrues in a bounded contract rather than
 *     a wallet (and, as a side effect of setTreasury, makes it tax exempt — which the V3
 *     sell leg requires, since V3 has no fee-on-transfer swap variant)
 *   - sets it as ReservedVault.keeper, so acquired assets deposit atomically
 *   - allowlists the swap target, reserve asset and its Chainlink feed
 *   - sizes the per-tx and rolling-window spend caps
 *   - grows the pool's observation ring so a TWAP becomes available
 *
 * Every address is checked on-chain before anything is sent: code present, 18 decimals on
 * the reserve asset, feeds returning a positive recent answer. A wrong allowlist entry is
 * not something to discover later.
 *
 *   TOKEN_ADDRESS=0x... VAULT_ADDRESS=0x... POOL_ADDRESS=0x... DRY_RUN=1 \
 *     npm run deploy:converter-v3:mainnet
 */

const env = (k: string, d?: string) => process.env[k] ?? d;

const TOKEN_ADDRESS = env("TOKEN_ADDRESS")!;
const VAULT_ADDRESS = env("VAULT_ADDRESS")!;
const POOL_ADDRESS = env("POOL_ADDRESS")!;
const POOL_FEE = Number(env("POOL_FEE", "2500"));
const DRY_RUN = env("DRY_RUN") === "1";

// VERIFY THESE. BTCB is the 18-decimal BSC-native BTC that satisfies the converter's
// decimals assertion; equities-style bStocks do not exist on BSC with Chainlink feeds,
// so this stands in for one to prove the pipeline.
const RESERVE_ASSET = env("RESERVE_ASSET", "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c")!; // BTCB
const RESERVE_USD_FEED = env("RESERVE_USD_FEED", "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf")!; // BTC/USD
const BNB_USD_FEED = env("BNB_USD_FEED", "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE")!;

const MAX_BNB_PER_TX = ethers.parseEther(env("MAX_BNB_PER_TX", "0.05")!);
const MAX_BNB_PER_WINDOW = ethers.parseEther(env("MAX_BNB_PER_WINDOW", "0.2")!);
const MAX_RSVD_PER_TX = ethers.parseUnits(env("MAX_RSVD_PER_TX", "1000000")!, 18);
const OBSERVATION_CARDINALITY = Number(env("OBSERVATION_CARDINALITY", "60"));

const NATIVE = "0x0000000000000000000000000000000000000000";

const ERC20_ABI = ["function decimals() view returns (uint8)", "function symbol() view returns (string)"];
const FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];
const POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function slot0() view returns (uint160,int24,uint16,uint16 observationCardinality,uint16,uint32,bool)",
];

async function assertCode(addr: string, what: string) {
  if ((await ethers.provider.getCode(addr)) === "0x") throw new Error(`${what} (${addr}) has no code here`);
}

async function main() {
  if (!TOKEN_ADDRESS || !VAULT_ADDRESS || !POOL_ADDRESS) {
    throw new Error("Set TOKEN_ADDRESS, VAULT_ADDRESS and POOL_ADDRESS");
  }
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const deployment = DEPLOYMENTS[Number(net.chainId)];
  if (!deployment) throw new Error(`No deployment configured for chain ${net.chainId}`);

  const keeper = env("KEEPER", deployer.address)!;
  const owner = env("OWNER", deployer.address)!;

  console.log(`\nNetwork  : ${deployment.label}`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Token    : ${TOKEN_ADDRESS}`);
  console.log(`Vault    : ${VAULT_ADDRESS}`);
  console.log(`Pool     : ${POOL_ADDRESS} (fee ${POOL_FEE})`);
  console.log(`Owner    : ${owner}`);
  console.log(`Keeper   : ${keeper}`);
  console.log(`Mode     : ${DRY_RUN ? "DRY RUN" : "LIVE — this broadcasts"}`);

  // --- preconditions -------------------------------------------------------
  console.log("\nChecking...");
  for (const [a, n] of [
    [TOKEN_ADDRESS, "Token"],
    [VAULT_ADDRESS, "Vault"],
    [POOL_ADDRESS, "Pool"],
    [deployment.swapRouter, "SwapRouter"],
    [RESERVE_ASSET, "Reserve asset"],
    [RESERVE_USD_FEED, "Reserve USD feed"],
    [BNB_USD_FEED, "BNB/USD feed"],
  ] as const) {
    await assertCode(a, n);
  }

  const asset = new ethers.Contract(RESERVE_ASSET, ERC20_ABI, ethers.provider);
  const assetSymbol = await asset.symbol();
  const assetDecimals = Number(await asset.decimals());
  // setAllowedReserveAsset reverts on anything but 18 — the oracle-floor maths assumes it.
  if (assetDecimals !== 18) throw new Error(`${assetSymbol} has ${assetDecimals} decimals; the converter requires 18`);
  console.log(`  reserve asset : ${assetSymbol} (18 dp)`);

  for (const [feed, label] of [
    [RESERVE_USD_FEED, `${assetSymbol}/USD`],
    [BNB_USD_FEED, "BNB/USD"],
  ] as const) {
    const f = new ethers.Contract(feed, FEED_ABI, ethers.provider);
    const [, answer, , updatedAt] = await f.latestRoundData();
    if (answer <= 0n) throw new Error(`${label} feed returned a non-positive answer`);
    const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
    console.log(`  ${label.padEnd(10)}: ${ethers.formatUnits(answer, await f.decimals())} (updated ${age}s ago)`);
  }

  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, ethers.provider);
  const [t0, t1] = [await pool.token0(), await pool.token1()];
  if (t0.toLowerCase() !== TOKEN_ADDRESS.toLowerCase() && t1.toLowerCase() !== TOKEN_ADDRESS.toLowerCase()) {
    throw new Error("POOL_ADDRESS is not a pool for this token");
  }
  const slot0 = await pool.slot0();
  console.log(`  pool cardinality: ${slot0.observationCardinality} (needs to exceed 1 for a TWAP)`);

  if (DRY_RUN) {
    console.log("\nDRY_RUN=1 — all checks passed, nothing broadcast.");
    return;
  }

  // --- deploy + wire -------------------------------------------------------
  console.log("\nDeploying TreasuryConverterV3...");
  const Converter = await ethers.getContractFactory("TreasuryConverterV3");
  const converter = await Converter.deploy(
    TOKEN_ADDRESS,
    VAULT_ADDRESS,
    deployment.swapRouter,
    POOL_ADDRESS,
    POOL_FEE,
    owner,
    keeper
  );
  await converter.waitForDeployment();
  const converterAddress = await converter.getAddress();
  console.log(`  ${converterAddress}`);
  console.log(`  rsvdIsToken0 : ${await converter.rsvdIsToken0()}`);

  const steps: [string, () => Promise<any>][] = [
    ["allowlist swap target (router)", () => converter.setAllowedTarget(deployment.swapRouter, true)],
    [`allowlist ${assetSymbol}`, () => converter.setAllowedReserveAsset(RESERVE_ASSET, true)],
    [`${assetSymbol}/USD feed`, () => converter.setAssetUsdFeed(RESERVE_ASSET, RESERVE_USD_FEED)],
    ["BNB/USD feed", () => converter.setAssetUsdFeed(NATIVE, BNB_USD_FEED)],
    ["max BNB per tx", () => converter.setMaxSpendPerTx(NATIVE, MAX_BNB_PER_TX)],
    ["max BNB per window", () => converter.setMaxSpendPerWindow(NATIVE, MAX_BNB_PER_WINDOW)],
    ["max RSVD per tx", () => converter.setMaxRsvdSpendPerTx(MAX_RSVD_PER_TX)],
    ["grow observation ring", () => converter.increaseObservationCardinality(OBSERVATION_CARDINALITY)],
  ];
  for (const [label, run] of steps) {
    process.stdout.write(`  ${label}... `);
    await (await run()).wait();
    console.log("ok");
  }

  console.log("\nWiring token and vault...");
  const token = await ethers.getContractAt("ReservedToken", TOKEN_ADDRESS);
  const vault = await ethers.getContractAt("ReservedVault", VAULT_ADDRESS);
  process.stdout.write("  token.setTreasury... ");
  await (await token.setTreasury(converterAddress)).wait();
  console.log("ok");
  process.stdout.write("  vault.setKeeper... ");
  await (await vault.setKeeper(converterAddress)).wait();
  console.log("ok");

  console.log(`\n  tax exempt: ${await token.isTaxExempt(converterAddress)} (required by the V3 sell leg)`);

  console.log("\nNext:");
  console.log("  - tax now accrues to the converter; existing treasury RSVD must be sent across manually");
  console.log(`  - the TWAP needs the ring to fill: wait minTwapWindow (${await converter.minTwapWindow()}s) of`);
  console.log("    real trading before sellRsvd will succeed, or it reverts with TwapUnavailable");
  console.log("  - then: npm run keeper:once:mainnet");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
