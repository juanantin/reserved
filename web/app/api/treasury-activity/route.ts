import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { ethers } from "ethers";
import { tokenInfo, reserveAssets } from "@/config/token";
import { getReadProvider, ERC20_TRANSFER_ABI, queryFilterWindowed } from "@/lib/contracts";

// Same reasoning as token-stats: a cached server route, not a per-visitor client scan,
// and cached via unstable_cache (not route-level `revalidate`) so a build with no RPC
// access doesn't fail trying to prerender this at build time — see token-stats/route.ts.
export const dynamic = "force-dynamic";
const REVALIDATE_SECONDS = 180;

// Ideally scans from the token's actual launch block rather than a trailing window —
// same fix, same reason, as token-stats/route.ts's holder count: a fixed trailing
// window looks fine on day one and then silently misses everything once the token
// outlives the window. The token relaunched at a new address and this file doesn't
// have that contract's launch block yet, so TRAILING_BLOCKS below is a temporary
// stopgap — see token-stats/route.ts for the same note, including why this window is
// sized to stay well clear of a serverless timeout (each of the 5 assets below scans
// concurrently with the others, and each one's own window scan is itself
// concurrency-batched via queryFilterWindowed rather than sequential). Swap in an exact
// LAUNCH_BLOCK the moment it's known.
const TRAILING_BLOCKS = 200_000;
const LOG_STEP = 2_000;

type Purchase = {
  symbol: string;
  asset: string;
  amount: string;
  from: string;
  txHash: string;
  blockNumber: number;
};

async function scanAsset(
  provider: ethers.Provider,
  from: number,
  head: number,
  tokenAddress: string,
  asset: { address: string; symbol: string }
): Promise<Purchase[]> {
  const erc20 = new ethers.Contract(asset.address, ERC20_TRANSFER_ABI, provider);
  let decimals = 18;
  try {
    decimals = Number(await erc20.decimals());
  } catch {
    // Fall back to 18 if the asset's metadata call fails — matches this project's
    // existing bStock allowlist, which is 18dp throughout.
  }

  // concurrency 4: five assets already scan in parallel via Promise.all below, so this
  // keeps peak concurrent RPC calls (5 assets x 4) reasonable for a public endpoint.
  const { logs } = await queryFilterWindowed(erc20, erc20.filters.Transfer(null, tokenAddress), from, head, LOG_STEP, 4);

  const results: Purchase[] = [];
  for (const log of logs) {
    const args = (log as ethers.EventLog).args;
    if (!args) continue;
    results.push({
      symbol: asset.symbol,
      asset: asset.address,
      amount: ethers.formatUnits(args[2] as bigint, decimals),
      from: args[0] as string,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }
  return results;
}

async function scanTreasuryActivity(tokenAddress: string) {
  const provider = getReadProvider();
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - TRAILING_BLOCKS);

  const perAsset = await Promise.all(reserveAssets.map((asset) => scanAsset(provider, from, head, tokenAddress, asset)));
  const purchases = perAsset
    .flat()
    .sort((a, b) => b.blockNumber - a.blockNumber)
    .slice(0, 25);

  return { purchases, scannedBlocks: head - from };
}

const cachedTreasuryActivity = unstable_cache(scanTreasuryActivity, ["treasury-activity"], { revalidate: REVALIDATE_SECONDS });

export async function GET() {
  if (!tokenInfo.tokenAddress) {
    return NextResponse.json({ purchases: [], scannedBlocks: 0 });
  }

  const result = await cachedTreasuryActivity(tokenInfo.tokenAddress);
  return NextResponse.json(result);
}
