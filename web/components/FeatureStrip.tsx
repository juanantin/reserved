import { Eye, PieChart, TrendingUp, Vote } from "lucide-react";
import { FadeIn } from "./FadeIn";
import { dictionaries, type Locale } from "@/lib/i18n";

const icons = [Eye, PieChart, TrendingUp, Vote];

export function FeatureStrip({ locale }: { locale: Locale }) {
  const items = dictionaries[locale].featureStrip;

  return (
    <section className="border-t border-white/10 px-6 py-14">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 md:grid-cols-4">
        {items.map(({ title, body }, i) => {
          const Icon = icons[i] ?? Eye;
          return (
            <FadeIn key={title} delay={i * 0.08} className="flex flex-col items-start gap-2">
              <Icon className="h-6 w-6 text-rsvd-gold" aria-hidden="true" />
              <div className="text-sm font-semibold">{title}</div>
              <p className="text-xs text-rsvd-offwhite/50">{body}</p>
            </FadeIn>
          );
        })}
      </div>
    </section>
  );
}
