import { FadeIn } from "./FadeIn";
import { HowItWorksDiagram } from "./HowItWorksDiagram";

const mobileSteps = [
  { title: "Trade RSVD", body: "Buy or sell on the open market." },
  { title: "3% buy/sell tax", body: "Collected in RSVD, sent to the keeper." },
  { title: "Keeper bot converts", body: "Swaps on PancakeSwap (primary), or buys via Binance API if slippage is high (fallback)." },
  { title: "Vault holds it", body: "Acquired bStocks land in the vault as backing." },
  { title: "Redeem any time", body: "Burn RSVD for a pro-rata share of everything the vault holds." },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">How It Works</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
            Every trade funds the reserve. Nothing here has run yet — this is the mechanism,
            not a transaction log.
          </p>
        </FadeIn>

        <FadeIn delay={0.1} className="mt-12 hidden md:block">
          <HowItWorksDiagram />
        </FadeIn>

        <div className="mt-10 grid gap-4 md:hidden">
          {mobileSteps.map((step, i) => (
            <FadeIn key={step.title} delay={i * 0.08} className="rounded-lg border border-white/10 bg-rsvd-navylight/40 p-5">
              <div className="text-xs font-mono text-rsvd-gold">0{i + 1}</div>
              <div className="mt-1 font-semibold">{step.title}</div>
              <p className="mt-1 text-sm text-rsvd-offwhite/60">{step.body}</p>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
