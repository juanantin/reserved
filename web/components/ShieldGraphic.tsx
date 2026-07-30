// Brand visual for the hero: a shield (what the reserve protects) holding the same
// ascending-bars motif as the logo's leg. Hand-drawn SVG, not a stock render — no
// fabricated numbers, just the mark.
export function ShieldGraphic({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 440" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="glow" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#D4AF37" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="shieldStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F2D989" />
          <stop offset="100%" stopColor="#D4AF37" />
        </linearGradient>
        <linearGradient id="barGold" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#B8912C" />
          <stop offset="100%" stopColor="#F2D989" />
        </linearGradient>
      </defs>

      <circle cx="200" cy="210" r="190" fill="url(#glow)" />

      <path
        d="M200 20 L340 70 V220 C340 320 280 380 200 420 C120 380 60 320 60 220 V70 Z"
        fill="#0D1B2A"
        fillOpacity="0.6"
        stroke="url(#shieldStroke)"
        strokeWidth="3"
      />

      <g>
        <rect x="140" y="260" width="30" height="60" rx="2" fill="url(#barGold)" opacity="0.75" />
        <rect x="185" y="220" width="30" height="100" rx="2" fill="url(#barGold)" opacity="0.88" />
        <rect x="230" y="170" width="30" height="150" rx="2" fill="url(#barGold)" />
      </g>
    </svg>
  );
}
