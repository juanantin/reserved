"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract, getTreasuryHoldings, BNB_USD_PRICE_FEED, CHAINLINK_FEED_ABI, PAIR_RESERVES_ABI } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { useTotalReserveValue } from "@/lib/useTotalReserveValue";
import { Logo } from "./Logo";
import { HistoricalValueChart } from "./HistoricalValueChart";
import { dictionaries, type Locale } from "@/lib/i18n";

const PAIR_ABI = PAIR_RESERVES_ABI;

type ReserveLine = { symbol: string; balance: string };

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
// than copying their light theme. Their reference also includes a "Historical
// Value" chart, explicitly labeled "DEMO" data — that needs real indexed
// event history (a subgraph/indexer) to do honestly, which is separate
// infrastructure work, not a UI change, so it's deliberately left out rather
// than faked.
export function DashboardCard({ locale }: { locale: Locale }) {
  const { address, wrongNetwork } = useWallet();
  const t = dictionaries[locale].dashboardCard;

  const [marketCapBnb, setMarketCapBnb] = useState<number | null>(null);
  const [marketCapUsd, setMarketCapUsd] = useState<number | null>(null);
  const [supply, setSupply] = useState<number | null>(null);
  const [reserves, setReserves] = useState<ReserveLine[] | null>(null);
  const { value: reserveValueUsd, incomplete: reserveValueIncomplete } = useTotalReserveValue();
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tokenInfo.tokenAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const token = getTokenContract(provider);

        const [supplyWei, holdings]: [bigint, Awaited<ReturnType<typeof getTreasuryHoldings>>] = await Promise.all([
          token.totalSupply(),
          getTreasuryHoldings(provider),
        ]);
        const supplyNum = Number(ethers.formatUnits(supplyWei, 18));

        const lines = holdings.map((h) => ({ symbol: h.symbol, balance: ethers.formatUnits(h.balance, 18) }));

        let marketCap: number | null = null;
        if (tokenInfo.pairAddress) {
          const pair = new ethers.Contract(tokenInfo.pairAddress, PAIR_ABI, provider);
          const [reserve0, reserve1]: [bigint, bigint] = await pair.getReserves();
          const token0: string = await pair.token0();
          const tokenIsToken0 = token0.toLowerCase() === tokenInfo.tokenAddress.toLowerCase();
          const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;
          const bnbReserve = tokenIsToken0 ? reserve1 : reserve0;
          if (tokenReserve > BigInt(0)) {
            const price = Number(ethers.formatEther(bnbReserve)) / Number(ethers.formatUnits(tokenReserve, 18));
            marketCap = price * supplyNum;
          }
        }

        // Chainlink's own on-chain feed, not a third-party API — no key, no
        // extra backend, consistent with everything else this reads directly.
        let marketCapInUsd: number | null = null;
        if (marketCap !== null) {
          try {
            const feed = new ethers.Contract(BNB_USD_PRICE_FEED, CHAINLINK_FEED_ABI, provider);
            const [decimals, roundData]: [number, [bigint, bigint, bigint, bigint, bigint]] = await Promise.all([
              feed.decimals(),
              feed.latestRoundData(),
            ]);
            const bnbUsd = Number(roundData[1]) / 10 ** Number(decimals);
            marketCapInUsd = marketCap * bnbUsd;
          } catch {
            // Price feed read failed — fall back to BNB-only display below.
          }
        }

        if (!cancelled) {
          setSupply(supplyNum);
          setReserves(lines.filter((l) => Number(l.balance) > 0));
          setMarketCapBnb(marketCap);
          setMarketCapUsd(marketCapInUsd);
        }
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
            : marketCapBnb !== null
              ? `${marketCapBnb.toLocaleString(undefined, { maximumFractionDigits: 2 })} BNB`
              : failed
                ? "—"
                : "..."}
        </div>
        {marketCapUsd !== null && marketCapBnb !== null && (
          <div className="mt-1 truncate font-mono text-xs text-rsvd-offwhite/40">
            {marketCapBnb.toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB
          </div>
        )}
      </div>

      <div className="border-b border-white/10 px-6 py-5 text-center">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.totalReserveValue}</div>
        <div className="mt-1 truncate font-mono text-2xl font-bold text-rsvd-gold">
          {reserveValueUsd !== null
            ? `$${reserveValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            : failed
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
          {reserves !== null ? reserves.length : failed ? "—" : "..."}
        </div>
      </div>

      <HistoricalValueChart locale={locale} />

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
                    {Number(r.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </div>
                </div>
              </div>
            ))}
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
                {sharePct !== null ? `${sharePct.toFixed(4)}%` : "—"}
              </div>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-rsvd-offwhite/50">{t.connectPrompt}</p>
        )}
      </div>
    </div>
  );
}
