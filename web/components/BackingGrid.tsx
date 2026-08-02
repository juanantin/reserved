"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { plannedReserveAssets } from "@/config/token";
import { FadeIn } from "./FadeIn";
import { VoteNextPanel } from "./VoteNextPanel";
import { dictionaries, type Locale } from "@/lib/i18n";

// Continuous 3D turn on the whole banner — the source image is one fused graphic
// (five overlapping coins baked into a single PNG), not five separate sprites, so
// they can't spin independently; this turns the group as one medallion instead.
// `perspective` on the wrapper is what makes rotateY read as genuine depth rather
// than a flat horizontal squash. Off entirely for prefers-reduced-motion.
function SpinningBanner() {
  const shouldReduceMotion = useReducedMotion();

  if (shouldReduceMotion) {
    return (
      <Image src="/images/bStocks.png" alt="bStocks" width={2018} height={678} className="h-auto w-full max-w-2xl" priority />
    );
  }

  return (
    <div style={{ perspective: 1200 }}>
      <motion.div
        animate={{ rotateY: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        className="max-w-2xl"
      >
        <Image src="/images/bStocks.png" alt="bStocks" width={2018} height={678} className="h-auto w-full" priority />
      </motion.div>
    </div>
  );
}

// Ticker badge — a plain monogram in the site's own palette rather than pulling in
// real brand marks (Nvidia's logo, Tesla's logo, etc.), which this project doesn't
// have license to use and which would also imply an official partnership that
// doesn't exist.
function TickerBadge({ symbol }: { symbol: string }) {
  // No truncation — bStock tickers carry a trailing "B" (NVDAB, TSLAB, ...) that
  // distinguishes them from the real stock's ticker (NVDA, TSLA, ...); cutting it off
  // would recreate exactly the mislabeling this grid was built to avoid.
  return (
    <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-md bg-rsvd-gold/10 font-mono text-[11px] font-bold text-rsvd-gold">
      {symbol}
    </span>
  );
}

export function BackingGrid({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].backingGrid;
  const [voteOpen, setVoteOpen] = useState(false);

  return (
    <div>
      <FadeIn immediate className="mb-6 flex justify-center">
        <SpinningBanner />
      </FadeIn>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {plannedReserveAssets.map((asset, i) => (
          <FadeIn key={asset.symbol} delay={i * 0.05}>
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-4">
              <TickerBadge symbol={asset.symbol} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{asset.symbol}</div>
                <div className="truncate text-xs text-rsvd-offwhite/50">{asset.name}</div>
              </div>
            </div>
          </FadeIn>
        ))}

        <FadeIn delay={plannedReserveAssets.length * 0.05}>
          <button
            type="button"
            onClick={() => setVoteOpen((v) => !v)}
            aria-expanded={voteOpen}
            className="flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors border-rsvd-gold/40 bg-rsvd-gold/5 hover:border-rsvd-gold"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-rsvd-gold/10 text-rsvd-gold">
              <HelpCircle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-rsvd-gold">{t.voteCardTitle}</div>
              <div className="truncate text-xs text-rsvd-offwhite/50">{t.voteCardSubtitle}</div>
            </div>
          </button>
        </FadeIn>
      </div>

      {voteOpen && (
        <FadeIn className="mt-4">
          <VoteNextPanel locale={locale} />
        </FadeIn>
      )}
    </div>
  );
}
