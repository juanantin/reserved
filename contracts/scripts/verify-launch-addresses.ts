import { ethers } from "hardhat";

// Sanity-checks every external mainnet address the launch depends on, before any of
// them get wired into TreasuryConverter with real money behind it. Run this from an
// environment that can actually reach BSC RPC (this repo's own build sandbox can't —
// its network policy blocks blockchain RPC hosts entirely, confirmed against several
// providers). Doesn't send any transactions — read-only.
//
//   PANCAKE_ROUTER=... USDT_ADDRESS=... PRICE_FEED_ADDRESS=... \
//   BSTOCKS=NVDAB:0x...,TSLAB:0x... \
//   npm run verify:launch-addresses:mainnet
//
// Every address below was found via web search and cross-referenced across 2+
// independent sources (BscScan listing titles, CoinGecko, Chainlink docs) — not
// independently confirmed on-chain, since this build environment can't reach BSC RPC.
// Treat every default here as "likely correct, unverified" until this script itself
// confirms it against the real chain.
const PANCAKE_ROUTER = process.env.PANCAKE_ROUTER || "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const PANCAKE_FACTORY = process.env.PANCAKE_FACTORY || "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "0x55d398326f99059fF775485246999027B3197955";
const PRICE_FEED_ADDRESS = process.env.PRICE_FEED_ADDRESS || "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE"; // Chainlink BNB/USD
const BSTOCKS = process.env.BSTOCKS || "NVDAB:0x02fca66c1d1afb4e2a7884261eb00f63598a7436";

const ERC20_ABI = ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"];
const ROUTER_ABI = ["function WETH() view returns (address)", "function factory() view returns (address)"];
const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];
const FEED_ABI = [
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
];

let failed = false;
function fail(msg: string) {
  failed = true;
  console.log(`  FAIL: ${msg}`);
}

async function main() {
  console.log("--- PancakeSwap router ---");
  const router = await ethers.getContractAt(ROUTER_ABI, PANCAKE_ROUTER);
  const wbnb: string = await router.WETH();
  const factoryFromRouter: string = await router.factory();
  console.log("  WETH() (WBNB):", wbnb);
  console.log("  factory():", factoryFromRouter);
  if (factoryFromRouter.toLowerCase() !== PANCAKE_FACTORY.toLowerCase()) {
    fail(`router.factory() (${factoryFromRouter}) doesn't match configured PANCAKE_FACTORY (${PANCAKE_FACTORY})`);
  }

  console.log("\n--- USDT ---");
  const usdt = await ethers.getContractAt(ERC20_ABI, USDT_ADDRESS);
  const usdtSymbol = await usdt.symbol();
  const usdtDecimals = Number(await usdt.decimals()); // ethers returns uint8 as bigint — must convert before comparing to a number
  console.log("  symbol:", usdtSymbol, "decimals:", usdtDecimals);
  if (usdtSymbol !== "USDT") fail(`expected symbol USDT, got ${usdtSymbol}`);
  if (usdtDecimals !== 18) fail(`TreasuryConverter requires 18 decimals, USDT_ADDRESS reports ${usdtDecimals}`);

  console.log("\n--- Chainlink BNB/USD feed ---");
  const feed = await ethers.getContractAt(FEED_ABI, PRICE_FEED_ADDRESS);
  const description = await feed.description();
  const feedDecimals = await feed.decimals();
  const roundData = await feed.latestRoundData();
  const answer = roundData[1];
  const updatedAt = Number(roundData[3]);
  const ageSeconds = Math.floor(Date.now() / 1000) - updatedAt;
  console.log("  description:", description);
  console.log("  decimals:", feedDecimals);
  console.log(`  answer: ${answer.toString()} (~$${Number(answer) / 10 ** Number(feedDecimals)})`);
  console.log(`  last updated: ${new Date(updatedAt * 1000).toISOString()} (${ageSeconds}s ago)`);
  if (!/BNB.*USD/i.test(description)) fail(`description "${description}" doesn't look like a BNB/USD feed`);
  if (answer <= 0n) fail("feed answer is not positive");
  if (ageSeconds > 3600) fail(`feed hasn't updated in ${ageSeconds}s — check it's not stale/deprecated`);

  console.log("\n--- bStocks ---");
  const factory = await ethers.getContractAt(FACTORY_ABI, PANCAKE_FACTORY);
  for (const entry of BSTOCKS.split(",")) {
    const [symbol, address] = entry.trim().split(":");
    console.log(`\n  ${symbol} (${address})`);
    const token = await ethers.getContractAt(ERC20_ABI, address);
    const [name, tokenSymbol, decimalsRaw] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
    const decimals = Number(decimalsRaw); // ethers returns uint8 as bigint — must convert before comparing to a number
    console.log(`    name: ${name}, symbol: ${tokenSymbol}, decimals: ${decimals}`);
    if (tokenSymbol !== symbol) fail(`expected symbol ${symbol}, got ${tokenSymbol}`);
    if (decimals !== 18) fail(`TreasuryConverter requires 18 decimals, ${symbol} reports ${decimals}`);

    async function reportPair(label: string, quoteAddress: string, quoteDecimals: number): Promise<boolean> {
      const pairAddress: string = await factory.getPair(address, quoteAddress);
      console.log(`    ${symbol}/${label} V2 pair: ${pairAddress}`);
      if (pairAddress === ethers.ZeroAddress) return false;
      const pair = await ethers.getContractAt(PAIR_ABI, pairAddress);
      const [reserve0, reserve1] = await pair.getReserves();
      const token0: string = await pair.token0();
      const bStockReserve = token0.toLowerCase() === address.toLowerCase() ? reserve0 : reserve1;
      const quoteReserve = token0.toLowerCase() === address.toLowerCase() ? reserve1 : reserve0;
      console.log(
        `      reserves: ${ethers.formatUnits(bStockReserve, 18)} ${symbol} / ${ethers.formatUnits(quoteReserve, quoteDecimals)} ${label}`
      );
      return quoteReserve > 0n;
    }

    // setBStockUsdtPair specifically needs a USDT pair — that's what the contract's
    // price floor math reads. But if that comes back empty, also check WBNB, purely as
    // a diagnostic: it tells us whether this bStock has *any* PancakeSwap V2 liquidity
    // at all, or whether it trades through V3/a different venue entirely (which would
    // mean this whole V2-pair-based price floor design doesn't apply to it as-is).
    const hasUsdtPair = await reportPair("USDT", USDT_ADDRESS, 18);
    if (!hasUsdtPair) {
      fail(`no PancakeSwap V2 ${symbol}/USDT pair with liquidity — can't set this as a price floor source`);
      const hasWbnbPair = await reportPair("WBNB", wbnb, 18);
      if (!hasWbnbPair) {
        console.log(
          `    ${symbol} has no V2 pair against USDT or WBNB either — it likely trades via PancakeSwap V3/a ` +
            `different venue, or has no on-chain liquidity yet. Check the PancakeSwap app directly for ${symbol}.`
        );
      }
    }
  }

  console.log("\n" + (failed ? "SOME CHECKS FAILED — do not deploy with these addresses until resolved." : "All checks passed."));
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
