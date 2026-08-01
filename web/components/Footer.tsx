import { Logo } from "./Logo";
import { LinksBar } from "./LinksBar";
import { tokenInfo } from "@/config/token";
import { dictionaries, type Locale } from "@/lib/i18n";

export function Footer({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].footer;

  return (
    <footer className="border-t border-white/10 px-6 py-12 text-sm text-rsvd-offwhite/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Logo size={22} />
            <span className="font-semibold text-rsvd-offwhite/80">RESERVED</span>
          </div>
          <LinksBar locale={locale} />
        </div>

        <p className="max-w-3xl">{t.disclaimer(tokenInfo.ticker)}</p>

        <p>{t.copyright(new Date().getFullYear())}</p>
      </div>
    </footer>
  );
}
