// Thin client for DexScreener's public token endpoint, shared by anything that needs a
// live USD price for an arbitrary BSC token address. Client-side calls are fine here —
// unlike the RPC log scans behind /api/token-stats, this is one lightweight request per
// asset, and DexScreener's API is built for direct browser use.
export async function fetchDexscreenerPriceUsd(tokenAddress: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pairs: Array<{ priceUsd?: string; liquidity?: { usd?: number } }> = Array.isArray(data?.pairs) ? data.pairs : [];
    if (pairs.length === 0) return null;
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    return best.priceUsd ? Number(best.priceUsd) : null;
  } catch {
    return null;
  }
}
