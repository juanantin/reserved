import { BNBLogo } from "./icons/BNBLogo";
import { tokenInfo } from "@/config/token";

export function ChainBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-rsvd-gold/40 bg-rsvd-gold/10 px-3 py-1 text-xs font-medium tracking-wide text-rsvd-gold uppercase">
      <BNBLogo className="h-3 w-3" />
      {tokenInfo.chain}
    </span>
  );
}
