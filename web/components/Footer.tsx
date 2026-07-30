import { Logo } from "./Logo";
import { tokenInfo } from "@/config/token";

export function Footer() {
  return (
    <footer className="border-t border-white/10 px-6 py-12 text-sm text-rsvd-offwhite/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-center gap-2">
          <Logo size={22} />
          <span className="font-semibold text-rsvd-offwhite/80">RESERVED</span>
        </div>

        <p className="max-w-3xl">
          {tokenInfo.ticker} is not deployed to mainnet. Nothing on this site is an offer to
          sell securities, and no reserve assets have been acquired yet. RSVD represents a
          claim on a reserve of tokenized-equity exposure; treat it accordingly and do your
          own research. This page is informational only, not financial or legal advice.
        </p>

        <p>&copy; {new Date().getFullYear()} Reserved. All figures on this site are illustrative until launch.</p>
      </div>
    </footer>
  );
}
