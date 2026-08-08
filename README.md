# Reserved (RSVD)

Real stocks. On-chain. Reserved.

An on-chain treasury on BNB Chain that acquires and holds tokenized stocks (Binance
bStocks) for the long term. Fixed-supply token; a 3% buy/sell tax funds the reserve;
holders redeem pro-rata on-chain at any time by burning.

## Structure

```
contracts/   Solidity (Hardhat) — token, vault, treasury converter, governance vote, tests
keeper/      Node/TypeScript keeper bot — calls the converter's bounded conversion functions
web/         Next.js 16 treasury dashboard (App Router, TypeScript, Tailwind v4)
```

Start with [`contracts/README.md`](./contracts/README.md) — it covers the architecture, the
security model, what a compromised keeper key can and cannot do, and the design decisions
that are deliberate rather than accidental.

## Current state, honestly

**Working and tested:** the token, the vault, redemption, the tax mechanism, and the
converter's sell leg (RSVD → BNB, bounded by a TWAP floor read from the RSVD/WBNB pair —
a pair this project creates and funds itself, so that mechanism is sound).

**Not working:** automated acquisition of bStocks. Not because of the contract — see
"What the probe established" in the contracts README — but because the venue settles via
signed off-chain RFQ quotes with a **40-second validity window**, and it is unresolved
whether those quotes can be obtained programmatically. Without a quote API there is no
automation, regardless of contract design.

**Viable in the meantime:** the manual bridge. bStocks are bought manually and deposited
into the vault via `depositReserveAsset`. Every user-facing claim stays true — the vault
holds real bStocks, holdings are on-chain verifiable, redemption is pro-rata and
permissionless — the only difference is that a human triggers the buy rather than a bot.

**Never audited. Never deployed to testnet in its current form. Ownership is a single EOA
in every deploy script.** All three are real gaps, not paperwork.

## Building

```bash
cd contracts && npm install && npm test     # 107 passing
cd ../web      && npm install && npm run dev
cd ../keeper   && npm install && npm run build
```

Copy `.env.example` to `.env` in `contracts/` and `keeper/` before running anything that
touches a chain. Never commit the real `.env` — it is gitignored, keep it that way.
