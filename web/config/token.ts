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
  tokenAddress: "0x8761873C64C1fB8e8174b9Ee39f11FFe4a3D8883",
  vaultAddress: "0x0Ec27569eb6Ac155aE18161DF1F5332c8f8900ea",

  // Set once a PancakeSwap pool exists. Used to read live price off the pair's
  // reserves (see DashboardCard) — not just for the buy/chart links below.
  pairAddress: "0x064B8301aC475789e8D6B7b8A4920127d5FCb80B",

  // Set once a PancakeSwap pool exists / the token is listed somewhere.
  buyUrl: "https://pancakeswap.finance/swap?outputCurrency=0x8761873C64C1fB8e8174b9Ee39f11FFe4a3D8883",
  chartUrl: "https://www.dextools.io/app/en/bnb/pair-explorer/0x064B8301aC475789e8D6B7b8A4920127d5FCb80B",
  explorerBaseUrl: "https://bscscan.com/address/",

  // Redemption happens directly on this site now (see RedeemPanel) — no external
  // redeemUrl needed. Kept as a field in case an external flow is ever preferred.
  redeemUrl: "",

  // Community links — set once these exist.
  xUrl: "https://x.com/ReservedFund_",
  telegramUrl: "https://t.me/ReservedPortal",

  // Set once ReservedGovernanceVote is deployed (see contracts/scripts/deploy-governance-vote.ts).
  governanceVoteAddress: "",
};

// bStock tickers the keeper is expected to acquire per the brief. These are the
// *planned* reserve assets, not a live holdings snapshot — the vault has not
// acquired anything yet from this site's perspective. This is the actual current
// Binance bStock catalog (5 tickers) — verified against on-chain BSC data, not
// aspirational; see "vote next" candidates below for stocks that don't have a
// bStock yet.
export const plannedReserveAssets = [
  { symbol: "NVDAB", name: "NVIDIA (bStock)" },
  { symbol: "TSLAB", name: "Tesla (bStock)" },
  { symbol: "CRCLB", name: "Circle (bStock)" },
  { symbol: "MUB", name: "Micron (bStock)" },
  { symbol: "SNDKB", name: "SanDisk (bStock)" },
];
