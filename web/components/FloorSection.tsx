import { FadeIn } from "./FadeIn";
import { ReserveValueLine } from "./ReserveValueLine";
import { dictionaries, type Locale } from "@/lib/i18n";

// Explains the redeem-driven price floor without the "can't go to zero" framing —
// that's an absolute guarantee this project deliberately doesn't make anywhere else
// (see PROJECT_BRIEF.md's accuracy-checked copy rules, the footer disclaimer, etc.),
// and it reads as bearish/defensive rather than a statement of fact. What's actually
// true and worth stating plainly: redeem() lets any holder burn RSVD for a pro-rata
// share of the vault at any time, unconditionally — so if RSVD ever traded meaningfully
// below reserve-value-per-token, that gap is a standing arbitrage (buy RSVD, redeem,
// take the reserve share), which is what ties price to the reserve rather than
// sentiment. That's a mechanism, not a promise — phrased that way here.
export function FloorSection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].floor;

  return (
    <section className="border-t border-white/10 px-6 py-20">
      <div
        className="mx-auto max-w-4xl rounded-2xl border border-rsvd-gold/20 px-6 py-14 sm:px-12"
        style={{ background: "radial-gradient(circle at 20% 15%, rgba(212,175,55,0.1), transparent 65%)" }}
      >
        <FadeIn>
          <p className="text-xs font-semibold uppercase tracking-widest text-rsvd-gold/70">{t.eyebrow}</p>
          <h2 className="mt-4 text-3xl font-bold leading-tight md:text-5xl">
            {t.headlinePrefix} <span className="text-gradient-gold">{t.headlineGold}</span>
          </h2>
          <p className="mt-5 max-w-2xl text-rsvd-offwhite/70">{t.body}</p>
          <ReserveValueLine locale={locale} />
        </FadeIn>
      </div>
    </section>
  );
}
