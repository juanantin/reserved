// Placeholder mark: an "R" with three ascending bars standing in for its leg,
// evoking the vault's rising-floor mechanic per PROJECT_BRIEF.md. Not final brand
// artwork — swap for a real vector logo (e.g. public/images/reserved-mark.svg) when
// one exists.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect x="10" y="10" width="14" height="44" rx="2" fill="currentColor" />
      <path
        d="M24 10 H38 C46 10 50 15 50 22 C50 29 46 33 38 33 H24 V24 H37 C40 24 41 23 41 22 C41 21 40 19 37 19 H24 Z"
        fill="currentColor"
      />
      <rect x="26" y="34" width="8" height="8" fill="currentColor" opacity="0.35" />
      <rect x="36" y="40" width="8" height="14" fill="currentColor" opacity="0.6" />
      <rect x="46" y="30" width="8" height="24" fill="currentColor" />
    </svg>
  );
}
