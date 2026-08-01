import { LineChart, Search } from "lucide-react";
import { tokenInfo } from "@/config/token";
import { XLogo } from "./icons/XLogo";
import { TelegramLogo } from "./icons/TelegramLogo";
import { CopyAddressButton } from "./CopyAddressButton";
import { dictionaries, type Locale } from "@/lib/i18n";

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <span
        title={label}
        aria-disabled="true"
        className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-md border border-white/10 text-rsvd-offwhite/25"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-rsvd-offwhite/70 transition-colors hover:border-rsvd-gold hover:text-rsvd-gold focus-gold"
    >
      {children}
    </a>
  );
}

export function LinksBar({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].linksBar;
  const bscscanUrl = tokenInfo.tokenAddress ? `${tokenInfo.explorerBaseUrl}${tokenInfo.tokenAddress}` : "";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconLink href={tokenInfo.xUrl} label={tokenInfo.xUrl ? t.twitter : t.comingSoon(t.twitter)}>
        <XLogo />
      </IconLink>
      <IconLink href={tokenInfo.telegramUrl} label={tokenInfo.telegramUrl ? t.telegram : t.comingSoon(t.telegram)}>
        <TelegramLogo />
      </IconLink>
      <IconLink href={tokenInfo.chartUrl} label={tokenInfo.chartUrl ? t.chart : t.comingSoon(t.chart)}>
        <LineChart className="h-4 w-4" />
      </IconLink>
      <IconLink href={bscscanUrl} label={bscscanUrl ? t.bscscan : t.comingSoon(t.bscscan)}>
        <Search className="h-4 w-4" />
      </IconLink>
      <div className="w-52">
        <CopyAddressButton address={tokenInfo.tokenAddress} label={t.contract} locale={locale} />
      </div>
    </div>
  );
}
