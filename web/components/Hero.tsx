import { StatusBadge } from "./StatusBadge";
import { ChainBadge } from "./ChainBadge";
import { FadeIn } from "./FadeIn";
import { BlockchainBackground } from "./BlockchainBackground";
import { DashboardCard } from "./DashboardCard";
import { Logo } from "./Logo";
import { dictionaries, type Locale } from "@/lib/i18n";

export function Hero({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].hero;

  return (
    <section id="top" className="relative overflow-hidden px-6 pb-16 pt-16 md:pt-20">
      <BlockchainBackground className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <div className="flex flex-col items-start gap-5">
          <FadeIn delay={0} immediate>
            <Logo size={88} />
          </FadeIn>

          <FadeIn delay={0.06}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge locale={locale} />
              <ChainBadge />
            </div>
          </FadeIn>

          <FadeIn delay={0.12}>
            <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-5xl">
              {t.titlePrefix}{" "}
              <span className="text-gradient-gold">{t.titleGold}</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.18}>
            <p className="text-base font-medium text-rsvd-offwhite/90">{t.taglineLine1}</p>
          </FadeIn>

          <FadeIn delay={0.26}>
            <div className="flex flex-wrap gap-4 pt-1">
              <a
                href="#how-it-works"
                className="rounded-md bg-rsvd-gold px-6 py-3 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold"
              >
                {t.ctaHowItWorks}
              </a>
              <a
                href="#treasury"
                className="rounded-md border border-white/20 px-6 py-3 text-sm font-semibold text-rsvd-offwhite transition-colors hover:border-rsvd-gold hover:text-rsvd-gold focus-gold"
              >
                {t.ctaViewTreasury}
              </a>
            </div>
          </FadeIn>
        </div>

        <FadeIn delay={0.2} immediate className="relative mx-auto w-full">
          <div
            className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(212,175,55,0.35) 0%, transparent 70%)" }}
            aria-hidden="true"
          />
          <DashboardCard locale={locale} />
        </FadeIn>
      </div>
    </section>
  );
}
