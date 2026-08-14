"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract } from "@/lib/contracts";
import { useTotalReserveValue } from "@/lib/useTotalReserveValue";
import { FadeIn } from "./FadeIn";
import { dictionaries, type Locale } from "@/lib/i18n";

export function LiveTreasuryStats({ locale }: { locale: Locale }) {
  const [supply, setSupply] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { value: reserveValueUsd, incomplete: reserveValueIncomplete, holdings } = useTotalReserveValue();
  const t = dictionaries[locale].treasury;
  const dc = dictionaries[locale].dashboardCard;

  const reserves = holdings ? holdings.filter((h) => h.balance > 0) : null;

  useEffect(() => {
    if (!tokenInfo.tokenAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const token = getTokenContract(provider);
        const totalSupply: bigint = await token.totalSupply();
        if (!cancelled) setSupply(ethers.formatUnits(totalSupply, 18));
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
      label: dc.totalReserveValue,
      value: reserveValueUsd !== null ? `$${reserveValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : failed ? t.unableToLoad : t.loading,
      note: reserveValueUsd !== null && reserveValueIncomplete ? dc.reserveValuePartial : null,
    },
    {
      label: t.reserveAssetsHeld,
      value: failed ? t.unableToLoad : reserves === null ? t.loading : reserves.length === 0 ? t.none : dc.assetCount(reserves.length),
      note: null,
    },
    { label: t.redemption, value: t.redemptionNotLive, note: null },
    {
      label: t.circulatingSupply,
      value: failed ? t.unableToLoad : supply !== null ? `${Number(supply).toLocaleString()} ${tokenInfo.ticker}` : t.loading,
      note: null,
    },
  ];

  return (
    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {facts.map((fact, i) => (
        <FadeIn key={fact.label} delay={i * 0.08} className="rounded-lg border border-white/10 bg-white/5 p-6">
          <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
          <div className="mt-2 text-lg font-semibold text-rsvd-gold">{fact.value}</div>
          {fact.note && <div className="mt-1 text-[10px] text-rsvd-offwhite/40">{fact.note}</div>}
        </FadeIn>
      ))}

      {reserves && reserves.length > 0 && (
        <div className="col-span-full rounded-lg border border-white/10 bg-white/5 p-6">
          <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{dc.vaultHoldings}</div>
          <ul className="mt-3 space-y-2">
            {reserves.map((r) => (
              <li key={r.address} className="flex items-baseline justify-between gap-3 font-mono text-sm text-rsvd-gold">
                <span className="shrink-0">{r.symbol}</span>
                <span className="h-px flex-1 bg-white/10" />
                <span className="shrink-0 text-rsvd-offwhite/70">{r.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                <span className="w-24 shrink-0 text-right">
                  {r.valueUsd !== null ? `$${r.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : dc.priceUnavailable}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3 font-mono text-sm">
            <span className="uppercase tracking-widest text-rsvd-offwhite/40">{dc.total}</span>
            <span className="font-semibold text-rsvd-gold">
              {reserveValueUsd !== null ? `$${reserveValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "..."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
