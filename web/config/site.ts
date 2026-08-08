// Labels come from lib/i18n.ts's `nav` dictionary (keyed by `key`); only the
// anchor order/hrefs live here since section ids don't change per locale. Hrefs
// starting with "#" are homepage anchors, resolved per-locale by Navbar's
// resolveHref (so they still work correctly when clicked from a subpage like /docs);
// "/docs" is an absolute path, resolved the same way.
export const navLinks = [
  { key: "treasury", href: "#treasury" },
  { key: "tokenomics", href: "#tokenomics" },
  { key: "howItWorks", href: "#how-it-works" },
  { key: "transparency", href: "#transparency" },
  { key: "governance", href: "#governance" },
  { key: "docs", href: "/docs" },
] as const;
