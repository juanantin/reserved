# Reserved (RSVD)

Real stocks. On-chain. Reserved.

An on-chain treasury on BNB Chain that acquires and holds tokenized stocks (Binance bStocks) for the long term. See [`PROJECT_BRIEF.md`](./PROJECT_BRIEF.md) for the full architecture, brand, and known constraints — read it before changing brand copy or making claims about what this project does.

## Structure

```
contracts/   Solidity (Hardhat) — ReservedToken (RSVD), ReservedVault, TreasuryConverter, tests
keeper/      Node/TypeScript keeper bot — calls TreasuryConverter's bounded conversion functions
web/         Next.js 16 treasury dashboard site (App Router, TypeScript, Tailwind v4)
```

Each has its own `README.md` with setup details: [`contracts/README.md`](./contracts/README.md), [`keeper/README.md`](./keeper/README.md), and below for `web/`.

## contracts/

```bash
cd contracts
npm install
npm test        # compiles via the solc npm package + runs the Hardhat test suite
```

17 tests covering the tax mechanism, burn/redeem, and pro-rata vault payouts — all passing. See `contracts/README.md` for why compilation goes through a custom offline script (this sandbox's network policy blocks Hardhat's usual solc downloader) and for deploy instructions. **Nothing has been deployed anywhere** — no testnet or mainnet deploy has been run from this repo yet.

## web/

```bash
cd web
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

Treasury dashboard site matching the Reserved brand (gold `#D4AF37` / navy `#0D1B2A` / `#1B263B` / near-black `#0A0A14` / off-white `#F5F5F5`, Sora font). All editable data lives in `web/config/token.ts` and `web/config/site.ts` — contract addresses, buy links, and community links default to `""` and render as "Coming soon" until you fill them in post-deploy, so the site never implies RSVD is live or tradable before it is.

The site deliberately does **not** show fabricated treasury figures, portfolio percentages, or holdings — those get faked in mockups but not in a real financial product's website. Sections describe the mechanism and show explicit "Not yet launched" / "Coming soon" states instead, per the accuracy-checked copy in `PROJECT_BRIEF.md`.

## What this covers vs. what's left

Built:
- RSVD token contract (fixed-supply BEP-20, buy/sell tax, burn-on-redeem)
- Vault contract (bStock reserve, pro-rata redemption)
- Full test suite (17 passing)
- Deploy script for BSC testnet/mainnet (not run)
- Treasury dashboard website (builds, lints, and renders correctly — verified with a headless browser)

Also built:
- `TreasuryConverter.sol` — bounded contract the treasury tax revenue flows into instead of a wallet, with no withdraw/rescue function of any kind; `sellRsvd` and `buyReserveAsset` are both protected by a real TWAP (+ Chainlink for the buy leg) price floor. See `contracts/README.md`'s Security section.
- Keeper bot (`keeper/`) — on-chain swap path is built and verified end-to-end against a real deployed `TreasuryConverter` on a local node (sell, buy, deposit into vault all confirmed working). See `keeper/README.md`.

Not built (see `PROJECT_BRIEF.md`'s phased plan and `contracts/README.md`'s "What's not here yet"):
- Keeper bot's Binance API fallback path — needs real Binance API credentials and a funded account this session doesn't have; wired into the bot's control flow but throws until implemented and tested for real (see `keeper/README.md`)
- A true PancakeSwap Infinity pool hook — the token uses a standard transfer-tax pattern instead; see `contracts/README.md` for the tradeoff
- Basket governance (voting) — explicitly a later phase
- Any actual deployment, testnet or mainnet — deploying costs real funds and requires a private key only you should hold
- Independent verification against backed.is's actual deployed source — this build environment's network policy blocked both backed.is and the Robinhood Chain explorer, so the mechanic here is reconstructed from public descriptions, not diffed line-by-line against the real thing
- Legal/securities-classification review, flagged as required before any public launch in `PROJECT_BRIEF.md`
- Contract audit
