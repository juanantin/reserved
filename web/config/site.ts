// Labels come from lib/i18n.ts's `nav` dictionary (keyed by `key`); only the
// anchor order/hrefs live here since section ids don't change per locale.
export const navLinks = [
  { key: "treasury", href: "#treasury" },
  { key: "tokenomics", href: "#tokenomics" },
  { key: "howItWorks", href: "#how-it-works" },
  { key: "transparency", href: "#transparency" },
  { key: "governance", href: "#governance" },
] as const;
