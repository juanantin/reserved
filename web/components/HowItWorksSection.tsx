import { FadeIn } from "./FadeIn";
import { HowItWorksDiagram } from "./HowItWorksDiagram";
import { dictionaries, type Locale } from "@/lib/i18n";

export function HowItWorksSection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].howItWorks;

  return (
    <section id="how-it-works" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">{t.title}</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">{t.description}</p>
        </FadeIn>

        <FadeIn delay={0.1} className="mt-12 hidden md:block">
          <HowItWorksDiagram locale={locale} />
        </FadeIn>

        <div className="mt-10 grid gap-4 md:hidden">
          {t.steps.map((step, i) => (
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
