import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// One allowlisted bStock the keeper will rebalance into, keyed by symbol for logging.
// `hops` is everything between WBNB and the token in the PancakeSwap route (usually
// empty — a direct WBNB/token pair); resolveBStocks below prepends the real WBNB
// address (read on-chain from the converter itself, never hardcoded here — see
// resolveBStocks) and appends the token address to build the full swap path.
export interface RawBStockConfig {
  symbol: string;
  address: string;
  hops: string[];
}

export interface BStockConfig {
  symbol: string;
  address: string;
  path: string[];
}

function parseBStocks(): RawBStockConfig[] {
  const raw = process.env.BSTOCKS || "";
  if (!raw.trim()) return [];
  return raw.split(",").map((entry) => {
    const [symbol, address, ...hops] = entry.trim().split(":");
    if (!symbol || !address) {
      throw new Error(`Malformed BSTOCKS entry "${entry}" — expected SYMBOL:address[:hop1:hop2:...]`);
    }
    return { symbol, address, hops };
  });
}

// Resolves each configured bStock's full swap path once WBNB's real address is known
// (fetched on-chain from converter.WBNB() in keeper.ts's buildContext — deliberately
// not hardcoded here, see the note above and the past incident it's guarding against:
// a memorized router address on this project once had a missing hex digit).
export function resolveBStocks(rawBStocks: RawBStockConfig[], wbnb: string): BStockConfig[] {
  return rawBStocks.map(({ symbol, address, hops }) => ({
    symbol,
    address,
    path: [wbnb, ...hops, address],
  }));
}

export const config = {
  rpcUrl: requireEnv("RPC_URL"),
  keeperPrivateKey: requireEnv("KEEPER_PRIVATE_KEY"),
  converterAddress: requireEnv("CONVERTER_ADDRESS"),
  rsvdAddress: requireEnv("RSVD_ADDRESS"),

  // How often the main loop runs. TWAP windows are typically 10+ minutes on-chain
  // (see TreasuryConverter.minTwapWindow), so polling much faster than that just wastes
  // gas on reverted "window not elapsed" attempts — the bot checks first and skips.
  pollIntervalSeconds: Number(optionalEnv("POLL_INTERVAL_SECONDS", "900")),

  // Dust filters — don't bother converting amounts too small to be worth the gas.
  minRsvdToSell: optionalEnv("MIN_RSVD_TO_SELL", "1000"), // whole RSVD
  minBnbToBuy: optionalEnv("MIN_BNB_TO_BUY", "0.05"), // whole BNB

  rawBStocks: parseBStocks(),

  // Binance API fallback (see binanceFallback.ts) — buys a bStock via Binance's spot API
  // and withdraws it to the vault when on-chain liquidity is too thin (detected by
  // simulating buyReserveAsset first — see tryBuyBstock in keeper.ts). Off unless both
  // keys are set; this repo has never had real Binance API credentials, so the fallback
  // path is wired in but has not been exercised against a live account. Treat it as
  // reviewed scaffolding, not a proven path, until it's been run for real.
  binanceApiKey: process.env.BINANCE_API_KEY || "",
  binanceApiSecret: process.env.BINANCE_API_SECRET || "",
  vaultAddress: process.env.VAULT_ADDRESS || "",
};

export const binanceFallbackConfigured = Boolean(config.binanceApiKey && config.binanceApiSecret && config.vaultAddress);
