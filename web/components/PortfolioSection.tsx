import { plannedReserveAssets, tokenInfo } from "@/config/token";

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

export function PortfolioSection() {
  return (
    <section id="portfolio" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold md:text-4xl">Portfolio</h2>
        <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
          How the reserve grows, and which bStocks the keeper is set up to acquire first.
          Nothing has been bought yet — the composition below is the acquisition plan, not a
          holdings snapshot.
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.title} className="rounded-lg border border-white/10 bg-rsvd-navylight/40 p-6">
              <div className="text-sm font-mono text-rsvd-gold">0{i + 1}</div>
              <div className="mt-2 text-lg font-semibold">{step.title}</div>
              <p className="mt-2 text-sm text-rsvd-offwhite/60">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <h3 className="text-sm uppercase tracking-widest text-rsvd-offwhite/40">
            Planned reserve assets
          </h3>
          <div className="mt-4 flex flex-wrap gap-3">
            {plannedReserveAssets.map((asset) => (
              <div
                key={asset.symbol}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm"
              >
                <span className="font-mono text-rsvd-gold">{asset.symbol}</span>
                <span className="ml-2 text-rsvd-offwhite/60">{asset.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
