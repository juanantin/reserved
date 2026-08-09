// Token/chain facts and every external link. Fields default to "" when not yet
// available; the UI shows a disabled/"coming soon" state for anything blank rather
// than implying RSVD is live, tradable, or deployed before it actually is.
export const tokenInfo = {
  name: "Reserved",
  ticker: "RSVD",
  chain: "BNB Chain",
  chainId: 56,
  fixedSupply: "1,000,000,000",
  // RSVD has no transfer tax. A fee on transfers cannot work on a V3 pool — the pool
  // demands the full input amount and reverts otherwise — so trading costs only the
  // pool's own swap fee. A treasury fee returns via an Infinity hook, at which point
  // this becomes the hook fee plus the pool fee.
  poolFeeBps: 25, // 0.25% PancakeSwap V3 fee tier — goes to liquidity providers
  // Charged by the swap hook, in BNB, and routed to the treasury. The token itself
  // charges nothing on transfers. Ships after the token and pool — see the docs.
  protocolFeeBps: 300,
  protocolFeeLive: false,

  // Set once each contract is deployed and verified.
  tokenAddress: "",
  vaultAddress: "",

  // Set once a PancakeSwap pool exists. Used to read live price off the pair's
  // reserves (see DashboardCard) — not just for the buy/chart links below.
  pairAddress: "",

  // Set once a PancakeSwap pool exists / the token is listed somewhere.
  buyUrl: "",
  chartUrl: "",
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

// bStock allowlist the keeper is authorized to acquire (see TreasuryConverter.sol's
// setAllowedReserveAsset). The site displays these under "Reserved Assets" now that
// it's serving a launched product, not a pre-launch mockup — but note the vault's
// actual on-chain holdings (LiveTreasuryStats, DashboardCard) are read live and shown
// separately; this list is the allowlist/target basket, not a claim that every asset
// here is currently held. Chosen from Binance's current bStock catalog (which has
// grown well past its original 5 — see "vote next" candidates below for names that
// don't have a bStock yet, e.g. SpaceX, which is only teased/pending its own Nasdaq
// listing, not tradable).
//
// Addresses below ARE independently confirmed: verify-launch-addresses.ts matched each
// one's on-chain name()/symbol()/decimals() against real BSC mainnet, and every one has
// since been round-trip traded for real (small manual buys/sells on PancakeSwap). What's
// still unconfirmed is *how* to acquire them programmatically — they trade via a signed
// RFQ/quote mechanism (settling against what BscScan tags as a BTech "Native: Vault"),
// not a plain PancakeSwap V2/V3 pool TreasuryConverter.sol currently knows how to read a
// price floor from. See contracts/README.md's Security section once that's written up.
export const reserveAssets = [
  { symbol: "CRCLB", name: "Circle (bStock)", address: "0x80f3d493ebce97e343c53d29a137942416b4ffc0" },
  { symbol: "NVDAB", name: "NVIDIA (bStock)", address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" },
  { symbol: "SNDKB", name: "SanDisk (bStock)", address: "0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb" },
  { symbol: "MUB", name: "Micron (bStock)", address: "0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699" },
  { symbol: "AMDB", name: "AMD (bStock)", address: "0x75fd4cf6f8392e41e70391d60c90c0d5211603a1" },
];
