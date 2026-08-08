"use client";

import { useState } from "react";
import { dictionaries, type Locale } from "@/lib/i18n";

export function CopyAddressButton({ address, label, locale }: { address: string; label: string; locale: Locale }) {
  const [copied, setCopied] = useState(false);
  const t = dictionaries[locale].copyAddressButton;

  if (!address) {
    return (
      <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-4 py-3">
        <span className="text-sm text-rsvd-offwhite/60">{label}</span>
        <span className="text-sm text-rsvd-offwhite/40">{t.comingSoon}</span>
      </div>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex w-full items-center justify-between rounded-md border border-rsvd-gold/30 bg-rsvd-gold/5 px-4 py-3 text-left transition-colors hover:border-rsvd-gold focus-gold"
    >
      <span className="text-sm text-rsvd-offwhite/60">{label}</span>
      <span className="font-mono text-sm text-rsvd-gold">
        {copied ? t.copied : `${address.slice(0, 6)}...${address.slice(-4)}`}
      </span>
    </button>
  );
}
