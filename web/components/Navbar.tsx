"use client";

import { useState } from "react";
import { Menu, X as CloseIcon } from "lucide-react";
import { navLinks } from "@/config/site";
import { tokenInfo } from "@/config/token";
import { Logo } from "./Logo";

function DashboardLink({ className }: { className?: string }) {
  const dashboardReady = Boolean(tokenInfo.tokenAddress);

  if (dashboardReady) {
    return (
      <a
        href={tokenInfo.buyUrl || "#treasury"}
        className={`rounded-md bg-rsvd-gold px-4 py-2 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold ${className ?? ""}`}
      >
        View Dashboard
      </a>
    );
  }

  return (
    <a
      href="#treasury"
      className={`rounded-md border border-rsvd-gold/40 px-4 py-2 text-sm font-semibold text-rsvd-gold/80 transition-colors hover:border-rsvd-gold hover:text-rsvd-gold focus-gold ${className ?? ""}`}
      title="Dashboard goes live once the contracts are deployed"
    >
      Dashboard — Coming Soon
    </a>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-rsvd-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="flex items-center gap-2 focus-gold" onClick={() => setOpen(false)}>
          <Logo size={32} />
          <span className="text-lg font-semibold tracking-wide">RESERVED</span>
        </a>

        <ul className="hidden items-center gap-8 text-sm text-rsvd-offwhite/80 md:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="transition-colors hover:text-rsvd-gold focus-gold">
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
          <DashboardLink />
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
                <a href={link.href} className="block focus-gold" onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <DashboardLink className="block w-full text-center" />
          </div>
        </nav>
      )}
    </header>
  );
}
