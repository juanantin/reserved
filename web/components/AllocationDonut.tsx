import { plannedReserveAssets } from "@/config/token";

// Equal-weight by construction — there's no live allocation yet, so this shows the
// acquisition plan, not a holdings snapshot. Segment shades are a gold monochrome
// ramp rather than introducing off-brand colors.
const SIZE = 200;
const STROKE = 26;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 6;

const shades = [1, 0.8, 0.62, 0.46, 0.32];

export function AllocationDonut() {
  const n = plannedReserveAssets.length;
  const segmentLength = CIRCUMFERENCE / n;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <div className="relative shrink-0">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {plannedReserveAssets.map((asset, i) => (
              <circle
                key={asset.symbol}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="#D4AF37"
                strokeOpacity={shades[i % shades.length]}
                strokeWidth={STROKE}
                strokeDasharray={`${segmentLength - GAP} ${CIRCUMFERENCE - (segmentLength - GAP)}`}
                strokeDashoffset={-(segmentLength * i)}
              />
            ))}
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-rsvd-gold">{n}</span>
          <span className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/50">assets</span>
        </div>
      </div>

      <div className="w-full">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {plannedReserveAssets.map((asset, i) => (
            <li key={asset.symbol} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: "#D4AF37", opacity: shades[i % shades.length] }}
                aria-hidden="true"
              />
              <span className="font-mono text-rsvd-gold">{asset.symbol}</span>
              <span className="text-rsvd-offwhite/50">{Math.round(100 / n)}%</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-rsvd-offwhite/40">
          Planned allocation, equal-weight — illustrative until the vault starts acquiring.
        </p>
      </div>
    </div>
  );
}
