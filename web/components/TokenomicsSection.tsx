import { tokenInfo } from "@/config/token";
import { FadeIn } from "./FadeIn";

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
            Fixed supply, taxed on every buy and sell. See{" "}
            <a href="#treasury" className="text-rsvd-gold underline-offset-4 hover:underline">
              Treasury
            </a>{" "}
            for the planned reserve composition.
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
      </div>
    </section>
  );
}
