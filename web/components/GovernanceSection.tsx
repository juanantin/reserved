import { Vote } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { FadeIn } from "./FadeIn";
import { dictionaries, type Locale } from "@/lib/i18n";

export function GovernanceSection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].governance;

  return (
    <section id="governance" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold md:text-4xl">{t.title}</h2>
            <StatusBadge locale={locale} label={t.badge} />
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-6 flex flex-col gap-6 rounded-lg border border-white/10 bg-rsvd-navylight/40 p-8 md:flex-row md:items-start">
            <Vote className="h-8 w-8 shrink-0 text-rsvd-gold" aria-hidden="true" />
            <div>
              <h3 className="text-lg font-semibold">{t.cardTitle}</h3>
              <p className="mt-2 max-w-2xl text-rsvd-offwhite/70">{t.cardBody}</p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
