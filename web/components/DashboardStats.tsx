"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract, getVaultContract } from "@/lib/contracts";
import { FadeIn } from "./FadeIn";

const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
];

type Stats = {
  priceBnb: number | null;
  marketCapBnb: number | null;
  supply: number | null;
  reserveAssetCount: number | null;
};

const EMPTY_STATS: Stats = { priceBnb: null, marketCapBnb: null, supply: null, reserveAssetCount: null };

// A live stats strip in the hero, in the vein of theindex.finance's dashboard-style
// homepage — real on-chain numbers up front rather than buried below the fold.
export function DashboardStats() {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tokenInfo.tokenAddress || !tokenInfo.vaultAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const token = getTokenContract(provider);
        const vault = getVaultContract(provider);

        const [supplyWei, [, balances]]: [bigint, [string[], bigint[]]] = await Promise.all([
          token.totalSupply(),
          vault.getReserveBalances(),
        ]);
        const supply = Number(ethers.formatUnits(supplyWei, 18));
        const reserveAssetCount = balances.filter((b) => b > BigInt(0)).length;

        let priceBnb: number | null = null;
        let marketCapBnb: number | null = null;
        if (tokenInfo.pairAddress) {
          const pair = new ethers.Contract(tokenInfo.pairAddress, PAIR_ABI, provider);
          const [reserve0, reserve1]: [bigint, bigint] = await pair.getReserves();
          const token0: string = await pair.token0();
          const tokenIsToken0 = token0.toLowerCase() === tokenInfo.tokenAddress.toLowerCase();
          const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
          const bnbReserve = tokenIsToken0 ? reserve1 : reserve0;
          if (tokenReserve > BigInt(0)) {
            priceBnb = Number(ethers.formatEther(bnbReserve)) / Number(ethers.formatUnits(tokenReserve, 18));
            marketCapBnb = priceBnb * supply;
          }
        }

        if (!cancelled) setStats({ priceBnb, marketCapBnb, supply, reserveAssetCount });
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tokenInfo.tokenAddress) return null;

  const fmt = (value: number | null, render: (v: number) => string) =>
    value !== null ? render(value) : failed ? "—" : "Loading...";

  const tiles = [
    { label: "Price", value: fmt(stats.priceBnb, (v) => `${v.toFixed(10)} BNB`) },
    { label: "Market Cap", value: fmt(stats.marketCapBnb, (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} BNB`) },
    { label: "Circulating Supply", value: fmt(stats.supply, (v) => `${v.toLocaleString()} ${tokenInfo.ticker}`) },
    { label: "Reserve Assets", value: fmt(stats.reserveAssetCount, (v) => String(v)) },
  ];

  return (
    <FadeIn delay={0.28} immediate className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-rsvd-gold/20 bg-white/5 px-4 py-3 backdrop-blur-sm"
        >
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{tile.label}</div>
          <div className="mt-1 truncate font-mono text-sm font-semibold text-rsvd-gold sm:text-base">
            {tile.value}
          </div>
        </div>
      ))}
    </FadeIn>
  );
}
