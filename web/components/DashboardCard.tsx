"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { useTotalReserveValue } from "@/lib/useTotalReserveValue";
import { useTokenStats } from "@/lib/useTokenStats";
import { Logo } from "./Logo";
import { dictionaries, type Locale } from "@/lib/i18n";

// Monochrome gold shades only — no off-brand colors for per-asset visual variety.
const MONOGRAM_SHADES = [1, 0.75, 0.55, 0.4];

function Monogram({ symbol, index }: { symbol: string; index: number }) {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-rsvd-black"
      style={{ backgroundColor: `rgba(212,175,55,${MONOGRAM_SHADES[index % MONOGRAM_SHADES.length]})` }}
      aria-hidden="true"
    >
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );
}

// A floating dashboard card in the hero — real on-chain figures styled after
// theindex.finance's homepage widget (headline stat, secondary stats, holdings
// list, connected-wallet panel), kept in Reserved's dark/gold palette rather
// than copying their light theme.
export function DashboardCard({ locale }: { locale: Locale }) {
  const { address, wrongNetwork } = useWallet();
  const t = dictionaries[locale].dashboardCard;

  const [supply, setSupply] = useState<number | null>(null);
  const { value: reserveValueUsd, incomplete: reserveValueIncomplete, holdings, failed: reserveFailed } = useTotalReserveValue();
  const { marketCapUsd, volume24hUsd, holders, holdersComplete, loading: statsLoading, failed: statsFailed } = useTokenStats();
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const reserves = holdings ? holdings.filter((h) => h.balance > 0) : null;

  useEffect(() => {
    if (!tokenInfo.tokenAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const token = getTokenContract(provider);
        const supplyWei: bigint = await token.totalSupply();
        if (!cancelled) setSupply(Number(ethers.formatUnits(supplyWei, 18)));
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadUser() {
      if (!address || wrongNetwork) {
        if (!cancelled) setUserBalance(null);
        return;
      }
      const provider = getReadProvider();
      const token = getTokenContract(provider);
      const bal: bigint = await token.balanceOf(address);
      if (!cancelled) setUserBalance(Number(ethers.formatUnits(bal, 18)));
    }
    loadUser();
    return () => {
      cancelled = true;
    };
  }, [address, wrongNetwork]);

  if (!tokenInfo.tokenAddress) return null;

  const sharePct = userBalance !== null && supply ? (userBalance / supply) * 100 : null;

  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-rsvd-gold/20 bg-rsvd-black/70 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-white/10 px-6 py-4">
        <Logo size={20} />
        <span className="text-sm font-semibold tracking-wide">RESERVED</span>
      </div>

      <div className="border-b border-white/10 px-6 py-6 text-center">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.marketCap}</div>
        <div className="mt-2 truncate font-mono text-4xl font-bold text-rsvd-gold">
          {marketCapUsd !== null
            ? `$${marketCapUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : statsFailed
              ? "—"
              : statsLoading
                ? "..."
                : t.noPoolYet}
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-white/10 border-b border-white/10 px-6 py-5 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.volume24h}</div>
          <div className="mt-1 truncate font-mono text-lg font-bold text-rsvd-offwhite">
            {volume24hUsd !== null
              ? `$${volume24hUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : statsFailed
                ? "—"
                : statsLoading
                  ? "..."
                  : "$0"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.holders}</div>
          <div className="mt-1 font-mono text-lg font-bold text-rsvd-offwhite">
            {holders !== null ? (holdersComplete ? holders.toLocaleString() : `${holders.toLocaleString()}+`) : statsFailed ? "—" : "..."}
          </div>
        </div>
      </div>

      <div className="border-b border-white/10 px-6 py-5 text-center">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.totalReserveValue}</div>
        <div className="mt-1 truncate font-mono text-2xl font-bold text-rsvd-gold">
          {reserveValueUsd !== null
            ? `$${reserveValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : reserveFailed
              ? "—"
              : "..."}
        </div>
        {reserveValueUsd !== null && reserveValueIncomplete && (
          <div className="mt-1 truncate text-[10px] text-rsvd-offwhite/40">{t.reserveValuePartial}</div>
        )}
      </div>

      <div className="border-b border-white/10 px-6 py-5 text-center">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.reserveAssets}</div>
        <div className="mt-1 font-mono text-lg font-bold text-rsvd-offwhite">
          {reserves !== null ? reserves.length : reserveFailed ? "—" : "..."}
        </div>
      </div>

      {reserves && reserves.length > 0 && (
        <div className="border-b border-white/10 px-6 py-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.vaultHoldings}</span>
            <span className="text-[10px] text-rsvd-offwhite/40">{t.assetCount(reserves.length)}</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {reserves.map((r, i) => (
              <div key={r.symbol} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <Monogram symbol={r.symbol} index={i} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-rsvd-offwhite">{r.symbol}</div>
                  <div className="truncate font-mono text-xs text-rsvd-gold">
                    {r.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </div>
                  <div className="truncate font-mono text-[10px] text-rsvd-offwhite/40">
                    {r.valueUsd !== null ? `$${r.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : t.priceUnavailable}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-white/10 pt-2">
            <span className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.total}</span>
            <span className="font-mono text-sm font-semibold text-rsvd-gold">
              {reserveValueUsd !== null ? `$${reserveValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "..."}
            </span>
          </div>
        </div>
      )}

      <div className="bg-rsvd-gold/10 px-6 py-5">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-gold/70">
          {address && !wrongNetwork ? t.yourPosition : t.connectToSeePosition}
        </div>
        {address && !wrongNetwork ? (
          <>
            <div className="mt-2 font-mono text-2xl font-bold text-rsvd-gold">
              {userBalance !== null ? userBalance.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "..."}{" "}
              {tokenInfo.ticker}
            </div>

            <div className="mt-3 border-t border-rsvd-gold/10 pt-3">
              <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.share}</div>
              <div className="mt-1 font-mono text-sm font-semibold text-rsvd-offwhite">
                {sharePct !== null ? `${sharePct.toFixed(4)}%` : failed ? "—" : "..."}
              </div>
            </div>

            {userBalance !== null && userBalance > 0 && supply && reserves && reserves.length > 0 && (
              <div className="mt-3 border-t border-rsvd-gold/10 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.yourShareOfReserve}</div>
                <ul className="mt-2 space-y-1">
                  {reserves.map((r) => (
                    <li key={r.address} className="flex justify-between font-mono text-xs text-rsvd-offwhite/80">
                      <span>{r.symbol}</span>
                      <span>{((userBalance / supply) * r.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] leading-relaxed text-rsvd-offwhite/40">{t.yourShareDisclaimer}</p>
              </div>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-rsvd-offwhite/50">{t.connectPrompt}</p>
        )}
      </div>
    </div>
  );
}
