"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { plannedReserveAssets } from "@/config/token";
import { FadeIn } from "./FadeIn";
import { VoteNextPanel } from "./VoteNextPanel";
import { dictionaries, type Locale } from "@/lib/i18n";

// The source bStocks.png is one flattened graphic with the coins overlapping/occluding
// each other — there's no way to recover a clean, independent circular coin per logo
// from it directly. But the logo glyphs themselves aren't occluded (only the gold disc
// edges are, where a neighboring coin overlaps them), so each glyph was extracted as its
// own transparent-background cutout (see web/public/images/bstock-icons/) and gets
// mounted on a freshly CSS-drawn gold coin here instead — genuinely independent discs
// that can each spin on their own.
const COIN_ICONS: { key: string; src: string; width: number; height: number }[] = [
  { key: "sandisk", src: "/images/bstock-icons/sandisk.png", width: 210, height: 167 },
  { key: "nvidia", src: "/images/bstock-icons/nvidia.png", width: 248, height: 172 },
  { key: "tesla", src: "/images/bstock-icons/tesla.png", width: 168, height: 238 },
  { key: "micron", src: "/images/bstock-icons/micron.png", width: 257, height: 155 },
  { key: "circle", src: "/images/bstock-icons/circle.png", width: 218, height: 246 },
];

function CoinFace({ src, width, height }: { src: string; width: number; height: number }) {
  return (
    <div
      className="flex h-24 w-24 items-center justify-center rounded-full md:h-28 md:w-28"
      style={{
        background: "radial-gradient(circle at 35% 30%, #FCEBA8 0%, #E9C25E 30%, #C89A2E 60%, #8a6d1d 100%)",
        boxShadow: "inset 0 2px 6px rgba(255,255,255,0.5), inset 0 -6px 10px rgba(0,0,0,0.35), 0 6px 14px rgba(0,0,0,0.4)",
      }}
    >
      <Image src={src} alt="" width={width} height={height} className="h-[55%] w-auto object-contain" />
    </div>
  );
}

// Each coin spins independently — its own perspective wrapper (so rotateY reads as
// depth, not a flat squash) and a slightly different duration/delay per coin so they
// don't all turn in lockstep. Off for prefers-reduced-motion.
function SpinningCoin({ src, width, height, index }: { src: string; width: number; height: number; index: number }) {
  const shouldReduceMotion = useReducedMotion();
  const face = <CoinFace src={src} width={width} height={height} />;

  if (shouldReduceMotion) return face;

  return (
    <div style={{ perspective: 800 }}>
      <motion.div animate={{ rotateY: 360 }} transition={{ duration: 6 + index * 0.6, repeat: Infinity, ease: "linear", delay: index * 0.15 }}>
        {face}
      </motion.div>
    </div>
  );
}

function SpinningCoins() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
      {COIN_ICONS.map((icon, i) => (
        <SpinningCoin key={icon.key} src={icon.src} width={icon.width} height={icon.height} index={i} />
      ))}
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
        <SpinningCoins />
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
