import { tokenInfo } from "@/config/token";
import { FadeIn } from "./FadeIn";
import { AllocationDonut } from "./AllocationDonut";

const tokenomics = [
  { label: "Ticker", value: tokenInfo.ticker },
  { label: "Chain", value: tokenInfo.chain },
  { label: "Fixed supply", value: `${tokenInfo.fixedSupply} ${tokenInfo.ticker}` },
  { label: "Buy/sell tax", value: `${tokenInfo.taxBps / 100}%` },
];

export function TokenomicsSection() {
  return (
    <section id="tokenomics" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">Tokenomics</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
            Fixed supply, taxed on trade, and the bStocks the keeper is set up to acquire
            first. Nothing has been bought yet — the composition below is the acquisition
            plan, not a holdings snapshot.
          </p>
        </FadeIn>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {tokenomics.map((fact, i) => (
            <FadeIn key={fact.label} delay={i * 0.06} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
              <div className="mt-1 text-lg font-semibold text-rsvd-gold">{fact.value}</div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.2} className="mt-10 rounded-lg border border-white/10 bg-white/5 p-6">
          <h3 className="text-sm uppercase tracking-widest text-rsvd-offwhite/40">
            Planned reserve assets
          </h3>
          <div className="mt-5">
            <AllocationDonut />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
