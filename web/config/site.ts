export const navLinks = [
  { label: "Treasury", href: "#treasury" },
  { label: "Vault", href: "#vault" },
  { label: "Transparency", href: "#transparency" },
  { label: "Governance", href: "#governance" },
];

// Accuracy-checked copy from PROJECT_BRIEF.md — do not add "decentralized",
// "100% on-chain", or "Community Owned" framing beyond what's written here.
export const features = [
  {
    title: "Real stocks",
    description: "Invested in tokenized equities issued via Binance's bStocks.",
  },
  {
    title: "Verifiable reserve",
    description:
      "Vault holdings checkable on-chain, block by block. Underlying share custody tracked via Binance's daily Proof of Collateral.",
  },
  {
    title: "Built to last",
    description: "Long-term treasury, designed to compound value over time.",
  },
  {
    title: "100% Reserved",
    description: "Vault assets 1:1 backed by tokenized stocks, verified via Binance Proof of Collateral.",
  },
];

export const faq = [
  {
    question: "Is Reserved decentralized?",
    answer:
      "Not yet. The treasury is keeper-operated at launch, not DAO-governed. Basket governance — token holders voting on which bStocks the reserve buys — is a planned later phase, not a current feature.",
  },
  {
    question: "What backs RSVD?",
    answer:
      "A vault of tokenized stocks (Binance bStocks), funded by a 3% tax on RSVD buys and sells. Holders can burn RSVD to redeem a pro-rata share of everything the vault holds.",
  },
  {
    question: "Is this trustless?",
    answer:
      "No — call it verifiable, not trustless. bStocks backing ultimately depends on Binance/BTech Holdings' Abu Dhabi SPV custody, which is custodial trust one layer up from the smart contracts. The vault's on-chain balances are independently checkable on BscScan at any time.",
  },
  {
    question: "Has this been audited?",
    answer:
      "Not yet. An audit pass is planned before any mainnet launch, alongside counsel review of the token's securities classification.",
  },
  {
    question: "When can I buy RSVD?",
    answer:
      "Not yet — the contracts have not been deployed to mainnet. This site will link out once a market exists.",
  },
];
