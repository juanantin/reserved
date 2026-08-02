"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";

// The source bStocks.png is one flattened graphic with the coins overlapping/occluding
// each other — there's no way to recover a clean, independent circular coin per logo
// from it directly. But the logo glyphs themselves aren't occluded (only the gold disc
// edges are, where a neighboring coin overlaps them), so each glyph was extracted as its
// own transparent-background cutout (see web/public/images/bstock-icons/) and gets
// mounted on a freshly CSS-drawn gold coin here instead — genuinely independent discs
// that can each spin on their own. Purely decorative — not tied to config/token.ts's
// reserveAssets list, so it's meant to render outside the Reserved Assets box rather
// than implying a 1:1 mapping between a specific coin and a specific listed asset.
const COIN_ICONS: { key: string; src: string; width: number; height: number }[] = [
  { key: "sandisk", src: "/images/bstock-icons/sandisk.png", width: 210, height: 167 },
  { key: "nvidia", src: "/images/bstock-icons/nvidia.png", width: 248, height: 172 },
  { key: "tesla", src: "/images/bstock-icons/tesla.png", width: 168, height: 238 },
  { key: "micron", src: "/images/bstock-icons/micron.png", width: 257, height: 155 },
  { key: "circle", src: "/images/bstock-icons/circle.png", width: 218, height: 246 },
];

// Layered gradient + inset shadows to fake an embossed/extruded metal disc (a curved
// highlight band catching light, plus a beveled rim) rather than a flat tinted circle —
// closer to the reference image's coins, which are visibly not just flat gold discs.
function CoinFace({ src, width, height }: { src: string; width: number; height: number }) {
  return (
    <div
      className="flex h-14 w-14 items-center justify-center rounded-full md:h-16 md:w-16"
      style={{
        background:
          "linear-gradient(125deg, #6b5416 0%, #a9822a 10%, #f5d576 22%, #fff6d9 30%, #f5d576 38%, #C89A2E 55%, #8a6d1d 78%, #6b5416 100%)",
        boxShadow:
          "inset 0 0 0 1px rgba(255,241,196,0.6), inset -3px -3px 6px rgba(0,0,0,0.45), inset 3px 3px 5px rgba(255,255,255,0.35), 0 3px 6px rgba(0,0,0,0.5)",
      }}
    >
      <Image src={src} alt="" width={width} height={height} className="h-[52%] w-auto object-contain drop-shadow-sm" />
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

export function ReserveCoins() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
      {COIN_ICONS.map((icon, i) => (
        <SpinningCoin key={icon.key} src={icon.src} width={icon.width} height={icon.height} index={i} />
      ))}
    </div>
  );
}
