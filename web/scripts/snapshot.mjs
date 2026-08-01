#!/usr/bin/env node
// Appends one real on-chain data point (market cap, supply, treasury balance,
// reserve asset count) to public/history.json. Run on a schedule via
// .github/workflows/snapshot.yml — this is what actually builds up genuine
// historical data for DashboardCard/HistoricalValueChart, starting from
// whenever this first ran. No backfilled or fabricated history before that.
//
// Deliberately standalone (duplicates a few constants/ABI fragments from
// lib/contracts.ts and config/token.ts) rather than importing them, since
// this runs as a plain Node script outside Next's build pipeline and
// shouldn't depend on its `@/` path aliases resolving.
import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, "..", "public", "history.json");
const MAX_POINTS = 720; // ~30 days at an hourly cadence

const RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org";
const TOKEN_ADDRESS = "0x8761873C64C1fB8e8174b9Ee39f11FFe4a3D8883";
const VAULT_ADDRESS = "0x0Ec27569eb6Ac155aE18161DF1F5332c8f8900ea";
const PAIR_ADDRESS = "0x064B8301aC475789e8D6B7b8A4920127d5FCb80B";

const TOKEN_ABI = [
  "function totalSupply() view returns (uint256)",
  "function treasury() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
];
const VAULT_ABI = ["function getReserveBalances() view returns (address[] tokens, uint256[] balances)"];
const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, 56);
  const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);

  const treasuryAddr = await token.treasury();
  const [supplyWei, [, balances], treasuryWei] = await Promise.all([
    token.totalSupply(),
    vault.getReserveBalances(),
    token.balanceOf(treasuryAddr),
  ]);
  const supply = Number(ethers.formatUnits(supplyWei, 18));
  const treasuryBal = Number(ethers.formatUnits(treasuryWei, 18));
  const reserveAssetCount = balances.filter((b) => b > 0n).length;

  let marketCapBnb = null;
  const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const token0 = await pair.token0();
  const tokenIsToken0 = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase();
  const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
  const bnbReserve = tokenIsToken0 ? reserve1 : reserve0;
  if (tokenReserve > 0n) {
    const price = Number(ethers.formatEther(bnbReserve)) / Number(ethers.formatUnits(tokenReserve, 18));
    marketCapBnb = price * supply;
  }

  const point = {
    t: Math.floor(Date.now() / 1000),
    marketCapBnb,
    supply,
    treasuryBal,
    reserveAssetCount,
  };

  let history = [];
  if (existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(HISTORY_PATH, "utf8"));
    } catch {
      history = [];
    }
  }
  history.push(point);
  if (history.length > MAX_POINTS) history = history.slice(history.length - MAX_POINTS);

  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
  console.log("Snapshot appended:", point);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
