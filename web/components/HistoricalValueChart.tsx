"use client";

import { useEffect, useState } from "react";

type Point = { t: number; marketCapBnb: number | null };

// Reads public/history.json — real snapshots appended hourly by
// .github/workflows/snapshot.yml (see scripts/snapshot.mjs), not fabricated
// or backfilled. Renders nothing until there's at least two real points to
// draw a trend between.
export function HistoricalValueChart() {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/history.json")
      .then((res) => res.json())
      .then((data: Point[]) => {
        if (!cancelled) setPoints(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || points === null) return null;

  const withValue = points.filter((p): p is { t: number; marketCapBnb: number } => p.marketCapBnb !== null);

  if (withValue.length === 0) return null;

  if (withValue.length < 2) {
    return (
      <div className="border-b border-white/10 px-6 py-5">
        <div className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">Historical Market Cap</div>
        <p className="mt-2 text-xs text-rsvd-offwhite/40">
          Tracking started {new Date(withValue[0].t * 1000).toLocaleDateString()} — chart fills in as snapshots
          accumulate (hourly).
        </p>
      </div>
    );
  }

  const recent = withValue.slice(-40);
  const max = Math.max(...recent.map((p) => p.marketCapBnb));
  const latest = recent[recent.length - 1].marketCapBnb;

  return (
    <div className="border-b border-white/10 px-6 py-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest text-rsvd-offwhite/40">Historical Market Cap</span>
        <span className="font-mono text-xs text-rsvd-gold">
          {latest.toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB
        </span>
      </div>
      <div className="mt-3 flex h-16 items-end gap-1">
        {recent.map((p, i) => (
          <div
            key={p.t}
            className="min-h-[4px] flex-1 rounded-sm bg-rsvd-gold"
            style={{
              height: `${max > 0 ? Math.max(4, (p.marketCapBnb / max) * 100) : 4}%`,
              opacity: 0.35 + 0.65 * (i / Math.max(1, recent.length - 1)),
            }}
            title={`${new Date(p.t * 1000).toLocaleString()}: ${p.marketCapBnb.toFixed(6)} BNB`}
          />
        ))}
      </div>
    </div>
  );
}
