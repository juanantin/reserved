"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract, getTreasuryHoldings } from "@/lib/contracts";
import { FadeIn } from "./FadeIn";
import { dictionaries, type Locale } from "@/lib/i18n";

type ReserveLine = { token: string; symbol: string; balance: string };

export function LiveTreasuryStats({ locale }: { locale: Locale }) {
  const [supply, setSupply] = useState<string | null>(null);
  const [reserves, setReserves] = useState<ReserveLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const t = dictionaries[locale].treasury;
  const dc = dictionaries[locale].dashboardCard;

  useEffect(() => {
    if (!tokenInfo.tokenAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const token = getTokenContract(provider);

        const [totalSupply, holdings] = await Promise.all([
          token.totalSupply() as Promise<bigint>,
          getTreasuryHoldings(provider),
        ]);
        if (cancelled) return;
        setSupply(ethers.formatUnits(totalSupply, 18));

        const lines = holdings.map((h) => ({ token: h.address, symbol: h.symbol, balance: ethers.formatUnits(h.balance, 18) }));
        setReserves(lines.filter((l) => Number(l.balance) > 0));
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

  // No vault contract holds an approval to pay out bStocks on burn — there is nowhere
  // for redeem() to live under this design, so it stays labeled honestly rather than
  // reusing the "pro-rata, on-chain, any time" line that was written for one.
  const facts = [
    {
      label: t.reserveAssetsHeld,
      value: failed ? t.unableToLoad : reserves === null ? t.loading : reserves.length === 0 ? t.none : dc.assetCount(reserves.length),
    },
    { label: t.redemption, value: t.redemptionNotLive },
    {
      label: t.circulatingSupply,
      value: failed ? t.unableToLoad : supply !== null ? `${Number(supply).toLocaleString()} ${tokenInfo.ticker}` : t.loading,
    },
  ];

  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-3">
      {facts.map((fact, i) => (
        <FadeIn key={fact.label} delay={i * 0.08} className="rounded-lg border border-white/10 bg-white/5 p-6">
          <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
          <div className="mt-2 text-lg font-semibold text-rsvd-gold">{fact.value}</div>
        </FadeIn>
      ))}

      {reserves && reserves.length > 0 && (
        <div className="col-span-full rounded-lg border border-white/10 bg-white/5 p-6">
          <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{dc.vaultHoldings}</div>
          <ul className="mt-3 space-y-2">
            {reserves.map((r) => (
              <li key={r.token} className="flex justify-between font-mono text-sm text-rsvd-gold">
                <span>{r.symbol}</span>
                <span>{Number(r.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
