import { Vote } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

export function GovernanceSection() {
  return (
    <section id="governance" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-bold md:text-4xl">Governance</h2>
          <StatusBadge label="Planned, later phase" />
        </div>

        <div className="mt-6 flex flex-col gap-6 rounded-lg border border-white/10 bg-rsvd-navylight/40 p-8 md:flex-row md:items-start">
          <Vote className="h-8 w-8 shrink-0 text-rsvd-gold" aria-hidden="true" />
          <div>
            <h3 className="text-lg font-semibold">Basket governance</h3>
            <p className="mt-2 max-w-2xl text-rsvd-offwhite/70">
              The plan: RSVD holders vote on which bStocks the reserve buys next. It is not
              live today — the treasury is keeper-operated at launch, not DAO-governed. This
              section will describe the actual voting mechanism once it ships, not before.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
