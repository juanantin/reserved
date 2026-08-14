import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { ethers } from "ethers";
import { tokenInfo, reserveAssets } from "@/config/token";
import { getReadProvider, ERC20_TRANSFER_ABI } from "@/lib/contracts";

// Same reasoning as token-stats: a cached server route, not a per-visitor client scan,
// and cached via unstable_cache (not route-level `revalidate`) so a build with no RPC
// access doesn't fail trying to prerender this at build time — see token-stats/route.ts.
export const dynamic = "force-dynamic";
const REVALIDATE_SECONDS = 180;

// Recent-window only, same tradeoff as the holder count in token-stats: this is "what's
// arrived lately," not the treasury's full acquisition history. bStocks sent to the
// token address before this window won't show up here — BscScan's own token page (linked
// from the site) is the source for full history.
const SCAN_MAX_BLOCKS = 30_000;
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

  const results: Purchase[] = [];
  for (let start = from; start <= head; start += LOG_STEP) {
    const end = Math.min(start + LOG_STEP - 1, head);
    try {
      const logs = await erc20.queryFilter(erc20.filters.Transfer(null, tokenAddress), start, end);
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
    } catch {
      // Best-effort — a failed window is skipped rather than failing the whole scan.
    }
  }
  return results;
}

async function scanTreasuryActivity(tokenAddress: string) {
  const provider = getReadProvider();
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - SCAN_MAX_BLOCKS);

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
