import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, TOKEN_ABI, queryFilterWindowed } from "@/lib/contracts";

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

// GoPlus Labs' token-security API — free, keyless (generous rate limit on the public
// tier), purpose-built for exactly this: it's what a lot of wallets and DEX front ends
// use for their own "holders" and risk stats. Tried first since it needs no setup on
// this site's end at all. A missing/malformed field just falls through to the next
// source rather than being treated as a real zero.
async function fetchHoldersFromGoPlus(tokenAddress: string): Promise<number | null> {
  try {
    const url = `https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${tokenAddress.toLowerCase()}`;
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data?.result?.[tokenAddress.toLowerCase()];
    const holders = Number(entry?.holder_count);
    return Number.isFinite(holders) && holders > 0 ? holders : null;
  } catch {
    return null;
  }
}

// BscScan itself tracks holder count from its own indexed history via the Etherscan V2
// unified API's tokeninfo action. Requires ETHERSCAN_API_KEY set in this site's own
// deployment env (separate from the contracts repo's .env — same key works, since it's
// the unified multichain API, but Vercel needs its own copy). Optional: GoPlus above is
// tried first and needs no key at all, so this is a secondary source, not a requirement.
async function fetchHoldersFromBscscan(tokenAddress: string): Promise<number | null> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.etherscan.io/v2/api?chainid=56&module=token&action=tokeninfo&contractaddress=${tokenAddress}&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    const data = await res.json();
    const result = Array.isArray(data?.result) ? data.result[0] : data?.result;
    const holders = Number(result?.holders ?? result?.holderCount);
    return Number.isFinite(holders) && holders > 0 ? holders : null;
  } catch {
    return null;
  }
}

// Fallback when BscScan's key isn't configured or its response doesn't carry a holder
// count on this key's tier. Ideally scans from the token's actual launch block (see
// docsContent.ts for why an exact block beats a trailing window: an earlier version
// scanned only the last ~30k blocks, which looked fine on day one and then silently
// undercounted, down to 0, the moment the token outlived the window, since the launch
// mint itself fell out of range). The token relaunched at a new address and this file
// doesn't have that contract's launch block yet, so TRAILING_BLOCKS is a temporary
// stopgap — swap it for an exact LAUNCH_BLOCK constant, same pattern as before, the
// moment that block number is known; a trailing window will silently start
// undercounting again once the token outlives it. `complete` is true only when every
// chunk of the scan succeeded.
//
// TRAILING_BLOCKS is deliberately not huge: a wide window scanned one window at a time
// is what caused holders to stop showing entirely right after this relaunch — 200
// sequential getLogs round trips to a public RPC is enough to blow a serverless
// function's execution timeout, which fails the whole route rather than just being
// slow. queryFilterWindowed below fetches windows several-at-a-time instead of one at a
// time, and this window is sized to comfortably cover a token that's hours to ~2 days
// old without needing an enormous number of windows.
const TRAILING_BLOCKS = 200_000;
const LOG_STEP = 2_000;

async function countHoldersOnChain(tokenAddress: string) {
  const provider = getReadProvider();
  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - TRAILING_BLOCKS);

  const { logs, anyWindowFailed } = await queryFilterWindowed(token, token.filters.Transfer(), from, head, LOG_STEP);

  const holders = new Set<string>();
  for (const log of logs) {
    const args = (log as ethers.EventLog).args;
    if (!args) continue;
    holders.add(args[0] as string);
    holders.add(args[1] as string);
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

  return { count: nonZero, complete: !anyWindowFailed };
}

async function getHolders(tokenAddress: string) {
  const fromGoPlus = await fetchHoldersFromGoPlus(tokenAddress);
  if (fromGoPlus !== null) return { count: fromGoPlus, complete: true };

  const fromBscscan = await fetchHoldersFromBscscan(tokenAddress);
  if (fromBscscan !== null) return { count: fromBscscan, complete: true };

  return countHoldersOnChain(tokenAddress);
}

const cachedDexscreener = unstable_cache(fetchDexscreener, ["dexscreener-stats"], { revalidate: REVALIDATE_SECONDS });
const cachedHolders = unstable_cache(getHolders, ["holder-count"], { revalidate: REVALIDATE_SECONDS });

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
