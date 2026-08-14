"use client";

import { tokenInfo } from "@/config/token";
import { useTotalReserveValue } from "@/lib/useTotalReserveValue";
import { dictionaries, type Locale } from "@/lib/i18n";

// Live figure at the bottom of FloorSection's claim — same computation DashboardCard
// uses (see lib/useTotalReserveValue.ts), so the two never drift out of sync.
export function ReserveValueLine({ locale }: { locale: Locale }) {
  const { value, incomplete, failed } = useTotalReserveValue();
  const dc = dictionaries[locale].dashboardCard;

  // Not deployed yet. Same bail-out DashboardCard uses.
  if (!tokenInfo.tokenAddress) return null;

  return (
    <div className="mt-8 border-t border-white/10 pt-6">
      <div className="text-xs font-semibold uppercase tracking-widest text-rsvd-gold/70">{dc.totalReserveValue}</div>
      <div className="mt-1 font-mono text-3xl font-bold text-rsvd-gold">
        {value !== null ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : failed ? "—" : "..."}
      </div>
      {value !== null && incomplete && <div className="mt-1 text-xs text-rsvd-offwhite/40">{dc.reserveValuePartial}</div>}
    </div>
  );
}
