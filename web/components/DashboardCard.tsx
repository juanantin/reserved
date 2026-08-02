"use client";

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { tokenInfo } from "@/config/token";
import { getReadProvider, getTokenContract, getVaultContract, BNB_USD_PRICE_FEED, CHAINLINK_FEED_ABI } from "@/lib/contracts";
import { useWallet } from "@/lib/useWallet";
import { Logo } from "./Logo";
import { HistoricalValueChart } from "./HistoricalValueChart";
import { dictionaries, type Locale } from "@/lib/i18n";

const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
];

type ReserveLine = { symbol: string; balance: string };
type RedeemLine = { symbol: string; amount: string };

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
  const [treasuryBal, setTreasuryBal] = useState<number | null>(null);
  const [reserves, setReserves] = useState<ReserveLine[] | null>(null);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [redeemPreview, setRedeemPreview] = useState<RedeemLine[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tokenInfo.tokenAddress || !tokenInfo.vaultAddress) return;
    let cancelled = false;

    async function load() {
      try {
        const provider = getReadProvider();
        const token = getTokenContract(provider);
        const vault = getVaultContract(provider);

        const treasuryAddr: string = await token.treasury();
        const [supplyWei, [tokens, balances], treasuryWei]: [bigint, [string[], bigint[]], bigint] = await Promise.all([
          token.totalSupply(),
          vault.getReserveBalances(),
          token.balanceOf(treasuryAddr),
        ]);
        const supplyNum = Number(ethers.formatUnits(supplyWei, 18));

        const lines = await Promise.all(
          tokens.map(async (t: string, i: number) => {
            let symbol = `${t.slice(0, 6)}...`;
            try {
              const meta = new ethers.Contract(t, ["function symbol() view returns (string)"], provider);
              symbol = await meta.symbol();
            } catch {
              // Fall back to the shortened address if the reserve asset's metadata call fails.
            }
            return { symbol, balance: ethers.formatUnits(balances[i], 18) };
          })
        );

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
          setTreasuryBal(Number(ethers.formatUnits(treasuryWei, 18)));
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
        if (!cancelled) {
          setUserBalance(null);
          setRedeemPreview(null);
        }
        return;
      }
      const provider = getReadProvider();
      const token = getTokenContract(provider);
      const vault = getVaultContract(provider);
      const bal: bigint = await token.balanceOf(address);
      if (cancelled) return;
      setUserBalance(Number(ethers.formatUnits(bal, 18)));

      if (bal > BigInt(0)) {
        const [tokens, amounts]: [string[], bigint[]] = await vault.previewRedeem(bal);
        const lines = await Promise.all(
          tokens.map(async (t: string, i: number) => {
            let symbol = `${t.slice(0, 6)}...`;
            try {
              const meta = new ethers.Contract(t, ["function symbol() view returns (string)"], provider);
              symbol = await meta.symbol();
            } catch {
              // Fall back to the shortened address if metadata isn't readable.
            }
            return { symbol, amount: ethers.formatUnits(amounts[i], 18) };
          })
        );
        if (!cancelled) setRedeemPreview(lines.filter((l) => Number(l.amount) > 0));
      } else if (!cancelled) {
        setRedeemPreview([]);
      }
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

      <div className="grid grid-cols-2 divide-x divide-white/10 border-b border-white/10 px-6 py-5 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.taxCollected}</div>
          <div className="mt-1 truncate font-mono text-lg font-bold text-rsvd-offwhite">
            {treasuryBal !== null
              ? `${treasuryBal.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenInfo.ticker}`
              : failed
                ? "—"
                : "..."}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.reserveAssets}</div>
          <div className="mt-1 font-mono text-lg font-bold text-rsvd-offwhite">
            {reserves !== null ? reserves.length : failed ? "—" : "..."}
          </div>
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

            <div className="mt-3 grid grid-cols-2 gap-4 border-t border-rsvd-gold/10 pt-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.share}</div>
                <div className="mt-1 font-mono text-sm font-semibold text-rsvd-offwhite">
                  {sharePct !== null ? `${sharePct.toFixed(4)}%` : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">{t.redeemable}</div>
                <div className="mt-1 font-mono text-sm font-semibold text-rsvd-offwhite">
                  {redeemPreview === null ? "..." : redeemPreview.length === 0 ? t.nothingYet : t.assetCount(redeemPreview.length)}
                </div>
              </div>
            </div>

            {redeemPreview && redeemPreview.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {redeemPreview.map((r, i) => (
                  <Monogram key={r.symbol} symbol={r.symbol} index={i} />
                ))}
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
