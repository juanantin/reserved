import { dictionaries, type Locale } from "@/lib/i18n";

type NodeLayout = {
  id: "trade" | "tax" | "keeper" | "swapDex" | "swapCex" | "vault" | "redeem";
  x: number;
  y: number;
  w: number;
  h: number;
  accent?: boolean;
};

// Coordinates live on a 1000x700 grid; both the SVG viewBox and the HTML node
// positions (as percentages) are derived from it, so they stay in lockstep.
// Text content lives in the i18n dictionary (keyed by the same node ids) so
// this layout doesn't need to change per locale.
const GRID_W = 1000;
const GRID_H = 700;

const layout: NodeLayout[] = [
  { id: "trade", x: 500, y: 46, w: 300, h: 64 },
  { id: "tax", x: 500, y: 156, w: 300, h: 64, accent: true },
  { id: "keeper", x: 500, y: 266, w: 220, h: 60 },
  { id: "swapDex", x: 290, y: 388, w: 260, h: 76 },
  { id: "swapCex", x: 710, y: 388, w: 260, h: 76 },
  { id: "vault", x: 500, y: 500, w: 320, h: 64, accent: true },
  { id: "redeem", x: 500, y: 610, w: 320, h: 64, accent: true },
];

const edges = [
  "M500,78 L500,124", // trade -> tax
  "M500,188 L500,236", // tax -> keeper
  "M500,296 L500,318 L290,318 L290,350", // keeper -> swap-dex
  "M500,296 L500,318 L710,318 L710,350", // keeper -> swap-cex
  "M290,426 L290,452 L500,452 L500,468", // swap-dex -> vault
  "M710,426 L710,452 L500,452 L500,468", // swap-cex -> vault
  "M500,532 L500,578", // vault -> redeem
];

function pct(value: number, total: number) {
  return `${(value / total) * 100}%`;
}

export function HowItWorksDiagram({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].howItWorks.diagram;

  return (
    <div className="relative mx-auto w-full" style={{ aspectRatio: `${GRID_W} / ${GRID_H}` }}>
      <svg viewBox={`0 0 ${GRID_W} ${GRID_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="#D4AF37" />
          </marker>
        </defs>
        {edges.map((d) => (
          <path key={d} d={d} fill="none" stroke="#D4AF37" strokeOpacity="0.5" strokeWidth="2" markerEnd="url(#flow-arrow)" />
        ))}
      </svg>

      {layout.map((node) => {
        const text = t[node.id];
        return (
          <div
            key={node.id}
            className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-lg border px-4 text-center ${
              node.accent ? "border-rsvd-gold/50 bg-rsvd-gold/10" : "border-white/15 bg-rsvd-navylight/60"
            }`}
            style={{
              left: pct(node.x, GRID_W),
              top: pct(node.y, GRID_H),
              width: pct(node.w, GRID_W),
              height: pct(node.h, GRID_H),
            }}
          >
            {"eyebrow" in text && text.eyebrow && (
              <span className="text-[10px] font-semibold uppercase tracking-widest text-rsvd-gold/80">{text.eyebrow}</span>
            )}
            <span className={`text-sm font-semibold md:text-base ${node.accent ? "text-rsvd-gold" : "text-rsvd-offwhite"}`}>
              {text.title}
            </span>
            <span className="text-xs text-rsvd-offwhite/60">{text.subtitle}</span>
          </div>
        );
      })}
    </div>
  );
}
