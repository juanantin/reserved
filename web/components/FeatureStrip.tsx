import { Eye, PieChart, TrendingUp, Vote } from "lucide-react";

const items = [
  { icon: Eye, title: "Transparent", body: "Vault holdings on-chain, always checkable." },
  { icon: PieChart, title: "Diversified", body: "Exposure across multiple tokenized equities." },
  { icon: TrendingUp, title: "Long-term", body: "Built for compounding value over time." },
  { icon: Vote, title: "Basket Governance", body: "Planned: holders vote on future acquisitions." },
];

export function FeatureStrip() {
  return (
    <section className="border-t border-white/10 bg-rsvd-black px-6 py-14">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 md:grid-cols-4">
        {items.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex flex-col items-start gap-2">
            <Icon className="h-6 w-6 text-rsvd-gold" aria-hidden="true" />
            <div className="text-sm font-semibold">{title}</div>
            <p className="text-xs text-rsvd-offwhite/50">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
