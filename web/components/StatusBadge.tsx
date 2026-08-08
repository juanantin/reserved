import { dictionaries, type Locale } from "@/lib/i18n";

// Reused wherever the site would otherwise have to either fabricate a live number
// or silently omit that something isn't live yet. Keeps "not deployed" honest and
// visible instead of implying RSVD is already trading.
export function StatusBadge({ locale, label }: { locale: Locale; label?: string }) {
  const text = label ?? dictionaries[locale].statusBadge.notYetLaunched;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-rsvd-gold/40 bg-rsvd-gold/10 px-3 py-1 text-xs font-medium tracking-wide text-rsvd-gold uppercase">
      <span className="h-1.5 w-1.5 rounded-full bg-rsvd-gold" />
      {text}
    </span>
  );
}
