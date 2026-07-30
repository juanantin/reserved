# Reserved contracts

Solidity for RSVD, the fixed-supply BEP-20 token, and its vault of tokenized-stock (bStock) reserves. See [`../PROJECT_BRIEF.md`](../PROJECT_BRIEF.md) for the full architecture and brand brief.

## Contracts

- **`ReservedToken.sol`** — fixed-supply BEP-20. 3% tax (owner-adjustable, hard-capped at 5%) on transfers touching a registered AMM pair address; tax accrues in RSVD to `treasury`. `ERC20Burnable` gives `burn`/`burnFrom`, used by the vault on redemption.
- **`ReservedVault.sol`** — holds bStocks (plain BEP-20 tokens) deposited by the `keeper`. `redeem(amount)` burns the caller's RSVD (via `burnFrom`, so `approve` the vault first) and pays out a pro-rata share of every tracked reserve asset, computed against total supply *before* the burn.
- **`mocks/MockERC20.sol`** — a mintable ERC20 standing in for bStocks in tests only. Never deployed to a real network.

**Important:** the tax is enforced at the ERC20 transfer layer (checking whether sender/recipient is a known AMM pair), not via a PancakeSwap Infinity pool hook as the brief describes. A real hook can skim the BNB/USDT leg of a swap mid-transaction; a transfer-tax override can only see the RSVD leg, so the keeper takes one extra step (sell taxed RSVD for BNB/USDT, then buy bStocks) instead of the hook skimming BNB/USDT directly. The vault's net economics are the same either way, but this is not the hook integration the brief specifies — treat it as the fallback/v1 mechanism and revisit once PancakeSwap Infinity's hook interfaces are integrated and independently verified.

Also unverified: this was built without access to backed.is's actual deployed source (the build sandbox's network policy blocked both `backed.is` and the Robinhood Chain explorer), so it's a reconstruction from public descriptions of the mechanic, not a line-by-line fork. Diff against backed.is's real contracts before treating this as a faithful port.

## Compiling and testing

`npx hardhat compile` will fail in this sandbox — the network policy blocks `binaries.soliditylang.org`, which Hardhat's compiler downloader needs. Everything here instead compiles through the `solc` **npm package** (a self-contained wasm build, fetched once via `npm install` from the already-allowlisted npm registry) via `scripts/offline-compile.js`, which writes Hardhat-format artifacts directly into `artifacts/`. Then Hardhat's test runner is pointed at those with `--no-compile`.

```bash
npm install
npm test              # runs offline-compile.js, then hardhat test --no-compile
```

If your environment *can* reach `binaries.soliditylang.org` (e.g. deploying from a normal dev machine, not this sandbox), plain `npx hardhat compile` / `npx hardhat test` work as usual and you can ignore the offline script entirely.

## Deploying

1. `cp .env.example .env` and fill in `DEPLOYER_PRIVATE_KEY`, RPC URLs, and a BscScan API key.
2. Edit `scripts/deploy.ts` — the owner/treasury/keeper addresses default to the deployer, which is only correct for a first testnet smoke deploy. Replace with your real multisig/treasury/keeper addresses before anything that touches mainnet.
3. `npm run deploy:testnet` (BSC testnet, chain id 97) or `npm run deploy:mainnet` (chain id 56).
4. After deploy: register the PancakeSwap RSVD/USDT pair via `token.setAmmPair(pair, true)`, and point the vault's `keeper` at the bot's operating address.

No deploy has been run from this session — there's no funded wallet, no private key, and no PancakeSwap pool to register here. `npm run deploy:testnet` is ready to go the moment you supply a funded testnet key in `.env`; mainnet deploy additionally needs the securities-classification legal review flagged in `PROJECT_BRIEF.md`.

## What's not here yet

Per the brief's phased plan, this covers phase 1 (token + vault + tests) only:

- **Keeper bot** (Node/TypeScript, on-chain PancakeSwap swap path + Binance API fallback) — not built. Needs Binance API credentials and a funded operating wallet this session doesn't have.
- **PancakeSwap Infinity hook** — not built; see the tax-mechanism note above.
- **Governance/basket voting** — explicitly a later phase per the brief; not built.
