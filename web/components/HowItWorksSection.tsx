import { tokenInfo } from "@/config/token";
import { FadeIn } from "./FadeIn";

const steps = [
  {
    title: "Trade",
    body: `Every ${tokenInfo.ticker} buy and sell carries a ${tokenInfo.taxBps / 100}% tax, collected in ${tokenInfo.ticker}.`,
  },
  {
    title: "Convert",
    body: "The keeper bot converts accumulated tax proceeds to BNB/USDT, then routes that into bStocks — on-chain via PancakeSwap when liquidity allows, via Binance API as a fallback.",
  },
  {
    title: "Reserve",
    body: "Acquired bStocks land in the vault as backing. Anyone can burn RSVD to redeem their pro-rata share of everything the vault holds.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">How It Works</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
            Three steps, every trade: tax collected, converted, reserved. Nothing has run yet
            — this is the mechanism, not a transaction log.
          </p>
        </FadeIn>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <FadeIn key={step.title} delay={i * 0.1} className="rounded-lg border border-white/10 bg-rsvd-navylight/40 p-6">
              <div className="text-sm font-mono text-rsvd-gold">0{i + 1}</div>
              <div className="mt-2 text-lg font-semibold">{step.title}</div>
              <p className="mt-2 text-sm text-rsvd-offwhite/60">{step.body}</p>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
