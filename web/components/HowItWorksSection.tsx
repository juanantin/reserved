import { FadeIn } from "./FadeIn";
import { HowItWorksDiagram } from "./HowItWorksDiagram";
import { BlockchainBackground } from "./BlockchainBackground";
import { dictionaries, type Locale } from "@/lib/i18n";

export function HowItWorksSection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].howItWorks;

  return (
    <section id="how-it-works" className="relative overflow-hidden border-t border-white/10 px-6 py-20">
      <BlockchainBackground className="pointer-events-none absolute inset-0 h-full w-full opacity-40" />
      <div className="relative mx-auto max-w-6xl">
        <FadeIn>
          <p className="text-xs font-semibold uppercase tracking-widest text-rsvd-offwhite/40">{t.title}</p>
          <h2 className="mt-3 text-3xl font-bold leading-tight md:text-5xl">
            {t.headlinePrefix}{" "}
            <a
              href="https://www.binance.com/en/bstocks-landing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gradient-gold underline-offset-4 hover:underline"
            >
              {t.headlineGold}
            </a>
            {t.headlineSuffix}
          </h2>
          <p className="mt-4 max-w-2xl text-rsvd-offwhite/70">{t.description}</p>
        </FadeIn>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {t.highlights.map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.08} className="rounded-lg border border-white/10 bg-rsvd-navylight/40 p-6">
              <div className="text-xs font-mono text-rsvd-gold">0{i + 1}</div>
              <div className="mt-2 font-semibold">{item.title}</div>
              <p className="mt-2 text-sm text-rsvd-offwhite/60">{item.body}</p>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.2} className="mx-auto mt-12 hidden max-w-3xl md:block">
          <HowItWorksDiagram locale={locale} />
        </FadeIn>
      </div>
    </section>
  );
}
