import { LineChart, Search, ArrowUpRight } from "lucide-react";
import { tokenInfo } from "@/config/token";
import { XLogo } from "./icons/XLogo";
import { TelegramLogo } from "./icons/TelegramLogo";
import { dictionaries, type Locale } from "@/lib/i18n";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function IconLink({
  href,
  label,
  gold,
  children,
}: {
  href: string;
  label: string;
  gold?: boolean;
  children: React.ReactNode;
}) {
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

  const goldClasses = "border-rsvd-gold/40 bg-rsvd-gold/10 text-rsvd-gold hover:border-rsvd-gold hover:bg-rsvd-gold/20";
  const neutralClasses = "border-white/10 text-rsvd-offwhite/70 hover:border-rsvd-gold hover:text-rsvd-gold";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors focus-gold ${gold ? goldClasses : neutralClasses}`}
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
      <IconLink href={tokenInfo.xUrl} label={tokenInfo.xUrl ? t.twitter : t.comingSoon(t.twitter)} gold>
        <XLogo />
      </IconLink>
      <IconLink href={tokenInfo.telegramUrl} label={tokenInfo.telegramUrl ? t.telegram : t.comingSoon(t.telegram)} gold>
        <TelegramLogo />
      </IconLink>
      <IconLink href={tokenInfo.chartUrl} label={tokenInfo.chartUrl ? t.chart : t.comingSoon(t.chart)}>
        <LineChart className="h-4 w-4" />
      </IconLink>
      <IconLink href={bscscanUrl} label={bscscanUrl ? t.bscscan : t.comingSoon(t.bscscan)}>
        <Search className="h-4 w-4" />
      </IconLink>
      {tokenInfo.tokenAddress ? (
        <a
          href={bscscanUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-52 items-center justify-between rounded-md border border-rsvd-gold/30 bg-rsvd-gold/5 px-4 py-3 text-left transition-colors hover:border-rsvd-gold focus-gold"
        >
          <span className="text-sm text-rsvd-offwhite/60">{t.contract}</span>
          <span className="flex items-center gap-1 font-mono text-sm text-rsvd-gold">
            {shortAddr(tokenInfo.tokenAddress)}
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </span>
        </a>
      ) : (
        <div className="flex w-52 items-center justify-between rounded-md border border-white/10 bg-white/5 px-4 py-3">
          <span className="text-sm text-rsvd-offwhite/60">{t.contract}</span>
          <span className="text-sm text-rsvd-offwhite/40">{dictionaries[locale].copyAddressButton.comingSoon}</span>
        </div>
      )}
    </div>
  );
}
