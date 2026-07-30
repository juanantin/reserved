// Token/chain facts and every external link. Fields default to "" when not yet
// available; the UI shows a disabled/"coming soon" state for anything blank rather
// than implying RSVD is live, tradable, or deployed before it actually is.
export const tokenInfo = {
  name: "Reserved",
  ticker: "RSVD",
  chain: "BNB Chain",
  chainId: 56,
  fixedSupply: "1,000,000,000",
  taxBps: 300, // 3% buy/sell tax, see PROJECT_BRIEF.md

  // Set once each contract is deployed and verified.
  tokenAddress: "",
  vaultAddress: "",

  // Set once a PancakeSwap pool exists / the token is listed somewhere.
  buyUrl: "",
  chartUrl: "",
  explorerBaseUrl: "https://bscscan.com/address/",

  // Set once the vault contract is deployed and a redeem UI exists.
  redeemUrl: "",

  // Community links — set once these exist.
  xUrl: "https://x.com/ReservedFund_",
  telegramUrl: "https://t.me/ReservedPortal",
};

// bStock tickers the keeper is expected to acquire per the brief. These are the
// *planned* reserve assets, not a live holdings snapshot — the vault has not
// acquired anything yet from this site's perspective.
export const plannedReserveAssets = [
  { symbol: "NVDAB", name: "NVIDIA (bStock)" },
  { symbol: "TSLAB", name: "Tesla (bStock)" },
  { symbol: "CRCLB", name: "Circle (bStock)" },
  { symbol: "MUB", name: "MicroStrategy (bStock)" },
  { symbol: "SNDKB", name: "SanDisk (bStock)" },
];
