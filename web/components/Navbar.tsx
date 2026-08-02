"use client";

import { useState } from "react";
import { Menu, X as CloseIcon } from "lucide-react";
import { navLinks } from "@/config/site";
import { tokenInfo } from "@/config/token";
import { useWallet } from "@/lib/useWallet";
import { dictionaries, type Locale } from "@/lib/i18n";
import { Logo } from "./Logo";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// navLinks entries are either same-page anchors ("#treasury") or absolute paths
// ("/docs"), written locale-agnostically. Resolve them per locale here rather than in
// config/site.ts, so a click from any page — including subpages like /docs — lands on
// the right locale's homepage anchor or subpage instead of a dead link.
function resolveHref(href: string, locale: Locale): string {
  if (href.startsWith("#")) return locale === "zh" ? `/zh${href}` : `/${href}`;
  return locale === "zh" ? `/zh${href}` : href;
}

function WalletButton({ locale, className }: { locale: Locale; className?: string }) {
  const { address, wrongNetwork, connecting, connect, disconnect, switchToBsc } = useWallet();
  const t = dictionaries[locale].wallet;
  const base = `rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-gold ${className ?? ""}`;

  if (!tokenInfo.tokenAddress) {
    return (
      <a
        href="#tokenomics"
        className={`rounded-md border border-rsvd-gold/40 px-4 py-2 text-sm font-semibold text-rsvd-gold/80 transition-colors hover:border-rsvd-gold hover:text-rsvd-gold focus-gold ${className ?? ""}`}
        title={t.dashboardComingSoon}
      >
        {t.dashboardComingSoon}
      </a>
    );
  }

  if (!address) {
    return (
      <button
        type="button"
        onClick={connect}
        disabled={connecting}
        className={`bg-rsvd-gold text-rsvd-black hover:opacity-90 disabled:opacity-60 ${base}`}
      >
        {connecting ? t.connecting : t.connect}
      </button>
    );
  }

  if (wrongNetwork) {
    return (
      <button type="button" onClick={switchToBsc} className={`border border-rsvd-gold/40 text-rsvd-gold hover:border-rsvd-gold ${base}`}>
        {t.wrongNetwork}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={disconnect}
      title={t.disconnectTitle}
      className={`border border-white/20 text-rsvd-offwhite hover:border-red-400/60 hover:text-red-400 ${base}`}
    >
      {shortAddr(address)}
    </button>
  );
}

function LangSwitcher({ locale, className, hrefOverride }: { locale: Locale; className?: string; hrefOverride?: string }) {
  const t = dictionaries[locale].langSwitcher;
  return (
    <a
      href={hrefOverride ?? t.href}
      className={`rounded-md border border-white/10 px-3 py-2 text-xs font-semibold text-rsvd-offwhite/70 transition-colors hover:border-rsvd-gold/50 hover:text-rsvd-gold ${className ?? ""}`}
    >
      {t.label}
    </a>
  );
}

// langHrefOverride: pages other than the two homepages (e.g. /docs, /zh/docs) need the
// switcher to jump to their own translated equivalent, not back to the site root —
// lib/i18n.ts's langSwitcher.href is only correct for "/" and "/zh" themselves.
export function Navbar({ locale, langHrefOverride }: { locale: Locale; langHrefOverride?: string }) {
  const [open, setOpen] = useState(false);
  const t = dictionaries[locale].nav;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-rsvd-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href={locale === "zh" ? "/zh" : "/"} className="flex items-center gap-2 focus-gold" onClick={() => setOpen(false)}>
          <Logo size={32} />
          <span className="text-lg font-semibold tracking-wide">RESERVED</span>
        </a>

        <ul className="hidden items-center gap-8 text-sm text-rsvd-offwhite/80 md:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a href={resolveHref(link.href, locale)} className="transition-colors hover:text-rsvd-gold focus-gold">
                {t[link.key]}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-3 md:flex">
          <LangSwitcher locale={locale} hrefOverride={langHrefOverride} />
          <WalletButton locale={locale} />
        </div>

        <button
          type="button"
          className="focus-gold rounded-md border border-white/20 p-2 text-rsvd-offwhite md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open && (
        <nav className="border-t border-white/10 bg-rsvd-black px-6 py-4 md:hidden">
          <ul className="flex flex-col gap-4 text-sm text-rsvd-offwhite/80">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a href={resolveHref(link.href, locale)} className="block focus-gold" onClick={() => setOpen(false)}>
                  {t[link.key]}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-3">
            <WalletButton locale={locale} className="block w-full text-center" />
            <LangSwitcher locale={locale} className="block w-full text-center" hrefOverride={langHrefOverride} />
          </div>
        </nav>
      )}
    </header>
  );
}
