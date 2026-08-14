"use client";

import { tokenInfo } from "@/config/token";
import { useTreasuryActivity } from "@/lib/useTreasuryActivity";
import { FadeIn } from "./FadeIn";
import { dictionaries, type Locale } from "@/lib/i18n";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Recent bStock purchases landing on the treasury address — backed by
// app/api/treasury-activity, a bounded recent-window scan (see that route). This is
// "what's arrived lately," not the full acquisition history, so it links out to BscScan
// for anyone who wants the complete record rather than implying this list is exhaustive.
export function TreasuryActivity({ locale }: { locale: Locale }) {
  const { purchases, loading, failed } = useTreasuryActivity();
  const t = dictionaries[locale].treasuryActivity;

  if (!tokenInfo.tokenAddress) return null;

  return (
    <FadeIn delay={0.28} className="mt-6 rounded-lg border border-white/10 bg-white/5 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm uppercase tracking-widest text-rsvd-offwhite/40">{t.title}</h3>
        <a
          href={`${tokenInfo.explorerBaseUrl}${tokenInfo.tokenAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[11px] text-rsvd-gold/70 hover:text-rsvd-gold"
        >
          {t.viewFullHistory}
        </a>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-rsvd-offwhite/50">{t.loading}</p>
      ) : failed ? (
        <p className="mt-4 text-sm text-rsvd-offwhite/50">{t.unableToLoad}</p>
      ) : purchases && purchases.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {purchases.map((p) => (
            <li
              key={p.txHash + p.asset + p.blockNumber}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
            >
              <span className="font-semibold text-rsvd-offwhite">{p.symbol}</span>
              <span className="font-mono text-rsvd-gold">
                {Number(p.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
              <span className="font-mono text-xs text-rsvd-offwhite/40">{shortAddr(p.from)}</span>
              <a
                href={`https://bscscan.com/tx/${p.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-rsvd-gold/70 hover:text-rsvd-gold"
              >
                {shortAddr(p.txHash)}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-rsvd-offwhite/50">{t.none}</p>
      )}

      <p className="mt-3 text-[10px] text-rsvd-offwhite/30">{t.disclaimer}</p>
    </FadeIn>
  );
}
