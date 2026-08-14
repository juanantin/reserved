import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, TOKEN_ABI } from "@/lib/contracts";

// Runs server-side on a cache, not per-visitor: DexScreener's API and the Transfer-log
// scan below are each one round trip per revalidation window, not one per page load.
// Doing the log scan from the browser instead would mean every visitor hammering the
// public BSC RPC with the same dozens of getLogs calls — that's what an indexer is for,
// and this project doesn't have one yet, so a cached server route is the stand-in.
//
// The caching lives on the two functions below via unstable_cache, not on route-level
// `revalidate` — a statically-revalidated route is prerendered at build time, which
// means every build needs live RPC/DexScreener access to succeed. unstable_cache defers
// the first real fetch to the first request instead, so a build with no network access
// (or a flaky RPC at deploy time) still succeeds; the page just fetches fresh on first
// hit after deploy.
export const dynamic = "force-dynamic";
const REVALIDATE_SECONDS = 120;

type DexscreenerPair = {
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
  liquidity?: { usd?: number };
};

async function fetchDexscreener(tokenAddress: string) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return { priceUsd: null, marketCapUsd: null, volume24hUsd: null };
    const data = await res.json();
    const pairs: DexscreenerPair[] = Array.isArray(data?.pairs) ? data.pairs : [];
    if (pairs.length === 0) return { priceUsd: null, marketCapUsd: null, volume24hUsd: null };
    // Multiple pairs can exist (different fee tiers, or listings elsewhere) — the one
    // with the most liquidity is the one actually setting price.
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    return {
      priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
      marketCapUsd: typeof best.marketCap === "number" ? best.marketCap : typeof best.fdv === "number" ? best.fdv : null,
      volume24hUsd: typeof best.volume?.h24 === "number" ? best.volume.h24 : null,
    };
  } catch {
    return { priceUsd: null, marketCapUsd: null, volume24hUsd: null };
  }
}

// Bounded, recent-window holder count — NOT a full historical scan. There is no indexer
// behind this site, so "every holder ever" would mean walking the chain from the
// contract's genesis block on every cache refresh, which only gets more expensive as the
// token ages and risks timing out the serverless function outright. Scanning the last
// ~30k blocks (roughly a day on BSC) and counting addresses that both appeared in that
// window and currently hold a non-zero balance is a live, honest sample — not a claim of
// completeness. `complete` says whether the scan actually reached genesis (true only for
// a token young enough that 30k blocks covers its whole life so far).
const HOLDER_SCAN_MAX_BLOCKS = 30_000;
const LOG_STEP = 2_000;

async function countHolders(tokenAddress: string) {
  const provider = getReadProvider();
  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - HOLDER_SCAN_MAX_BLOCKS);

  const holders = new Set<string>();
  let anyWindowFailed = false;
  for (let start = from; start <= head; start += LOG_STEP) {
    const end = Math.min(start + LOG_STEP - 1, head);
    try {
      const logs = await token.queryFilter(token.filters.Transfer(), start, end);
      for (const log of logs) {
        const args = (log as ethers.EventLog).args;
        if (!args) continue;
        holders.add(args[0] as string);
        holders.add(args[1] as string);
      }
    } catch {
      anyWindowFailed = true;
    }
  }
  holders.delete(ethers.ZeroAddress);

  const addrs = Array.from(holders);
  let nonZero = 0;
  const BATCH = 25;
  for (let i = 0; i < addrs.length; i += BATCH) {
    const batch = addrs.slice(i, i + BATCH);
    const balances = await Promise.all(batch.map((a) => token.balanceOf(a).catch(() => BigInt(0)) as Promise<bigint>));
    nonZero += balances.filter((b) => b > BigInt(0)).length;
  }

  return { count: nonZero, complete: !anyWindowFailed && from === 0 };
}

const cachedDexscreener = unstable_cache(fetchDexscreener, ["dexscreener-stats"], { revalidate: REVALIDATE_SECONDS });
const cachedHolders = unstable_cache(countHolders, ["holder-count"], { revalidate: REVALIDATE_SECONDS });

export async function GET() {
  if (!tokenInfo.tokenAddress) {
    return NextResponse.json({ priceUsd: null, marketCapUsd: null, volume24hUsd: null, holders: null, holdersComplete: false });
  }

  const [dex, holderResult] = await Promise.all([
    cachedDexscreener(tokenInfo.tokenAddress),
    cachedHolders(tokenInfo.tokenAddress).catch(() => null),
  ]);

  return NextResponse.json({
    priceUsd: dex.priceUsd,
    marketCapUsd: dex.marketCapUsd,
    volume24hUsd: dex.volume24hUsd,
    holders: holderResult?.count ?? null,
    holdersComplete: holderResult?.complete ?? false,
  });
}
