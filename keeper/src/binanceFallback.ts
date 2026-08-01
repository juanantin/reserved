import { logger } from "./logger";
import { binanceFallbackConfigured } from "./config";

/// Fallback path for when on-chain PancakeSwap liquidity for a bStock is too thin to
/// buy through cleanly (see PROJECT_BRIEF.md's "Known constraints"): buy the bStock on
/// Binance's spot market, then withdraw the BEP-20 token on-chain to the vault address.
///
/// This is genuinely unimplemented against Binance's real API — doing that safely
/// (signed REST calls, withdrawal address allowlisting, handling partial fills, rate
/// limits, and 2FA/whitelist requirements on withdrawals) needs real Binance API
/// credentials and a funded Binance account to build and test against, neither of which
/// this project has had access to. The function is wired into the keeper's main loop
/// (see keeper.ts) so the call site and control flow are real, but it deliberately
/// refuses to silently no-op or fake success — it throws until someone with a live
/// Binance account implements and tests it for real.
export async function buyViaBinanceFallback(symbol: string, bnbAmount: string): Promise<never> {
  logger.warn(
    `On-chain liquidity for ${symbol} looks too thin for a ${bnbAmount} BNB buy, and the Binance API fallback ` +
      `was reached — but it is not implemented. See keeper/src/binanceFallback.ts.`
  );
  if (!binanceFallbackConfigured) {
    throw new Error(
      "Binance API fallback not configured (missing BINANCE_API_KEY, BINANCE_API_SECRET, or VAULT_ADDRESS) " +
        "and not implemented. Skipping this bStock this cycle — buy it manually if urgent."
    );
  }
  throw new Error(
    `Binance API fallback for ${symbol} is configured but not implemented (see binanceFallback.ts). ` +
      "Implement the signed Binance spot-buy + withdrawal-to-vault flow and test it against a real " +
      "Binance account before relying on this path."
  );
}
