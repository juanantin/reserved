// Stylized nod to the BNB Chain mark (a plus-arrangement of diamonds) — not a
// reproduction of Binance's official trademarked asset, same spirit as the
// custom XLogo/TelegramLogo stand-ins.
export function BNBLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="9" y="9" width="6" height="6" transform="rotate(45 12 12)" />
      <rect x="1" y="9" width="6" height="6" transform="rotate(45 4 12)" />
      <rect x="17" y="9" width="6" height="6" transform="rotate(45 20 12)" />
      <rect x="9" y="1" width="6" height="6" transform="rotate(45 12 4)" />
      <rect x="9" y="17" width="6" height="6" transform="rotate(45 12 20)" />
    </svg>
  );
}
