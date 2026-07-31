# Reserved contracts

Solidity for RSVD, the fixed-supply BEP-20 token, and its vault of tokenized-stock (bStock) reserves. See [`../PROJECT_BRIEF.md`](../PROJECT_BRIEF.md) for the full architecture and brand brief.

## Contracts

- **`ReservedToken.sol`** — fixed-supply BEP-20. 3% tax (owner-adjustable, hard-capped at 5%) on transfers touching a registered AMM pair address; tax accrues in RSVD to `treasury`. `ERC20Burnable` gives `burn`/`burnFrom`, used by the vault on redemption. `Ownable2Step`.
- **`ReservedVault.sol`** — holds bStocks (plain BEP-20 tokens) deposited by the `keeper`. `redeem(amount)` burns the caller's RSVD (via `burnFrom`, so `approve` the vault first) and pays out a pro-rata share of every tracked reserve asset, computed against total supply *before* the burn. `Ownable2Step`.
- **`mocks/MockERC20.sol`**, **`mocks/MockRevertingERC20.sol`** — test-only stand-ins for bStocks (the latter always reverts on transfer, used to test redeem's failure handling). Never deployed to a real network.
- **`vendor/TimelockController.sol`** — thin re-export of OpenZeppelin's `TimelockController`, unmodified. See "Timelock" below.

## Security

What's actually been hardened, what's deliberately been left alone, and what a scanner might still flag even so:

- **No fund-drain backdoor exists.** Neither contract has an owner-only withdraw/rescue function for vault assets. This is intentional, not an oversight — a "rescue stuck tokens" function is also, by construction, a "rug the entire reserve" function, and that directly contradicts "verifiable reserve, redeemable any time, no permission." If a wrong token ends up in the vault, it's stuck; that's the accepted cost of not having an owner-drain lever.
- **No mint, no blacklist, symmetric buy/sell tax.** Checked against the standard scanner/honeypot heuristics: fixed supply with no post-deploy mint path, no address-blocking function anywhere, and buy/sell share one `taxBps` (there's no separate "sell tax" that could be cranked up to block selling while buys stay cheap — the classic honeypot pattern). No proxy/upgradeability (bytecode is immutable once deployed), no `selfdestruct`, no `delegatecall` to a user- or owner-suppliable address.
- **`Ownable2Step`, not `Ownable`**, on both contracts — `transferOwnership` alone doesn't move ownership; the new owner must call `acceptOwnership()`. Plain `Ownable` has a real history of projects permanently bricking admin control by fat-fingering a `transferOwnership` call to an address nobody controls.
- **`redeem()` degrades gracefully instead of bricking.** A naive "loop over every reserve asset and transfer" reverts the *entire* redemption if even one asset misbehaves (reverts on transfer, blacklists this vault, gets paused, or is otherwise broken) — which would lock 100% of the vault for 100% of holders over one bad token. `redeem()` now attempts each transfer independently via `try/catch`, skips (and emits `RedeemAssetSkipped` for) whatever fails, and still pays out everything that works. Covered by a test that deploys a reserve asset which always reverts and confirms redemption still succeeds for the good asset.
- **Tax rate hard-capped** at `MAX_TAX_BPS` (5%) — the owner can never raise it to a level that functions as a rug.
- **`nonReentrant`** on `redeem()` and `depositAsset()`; burn happens before payout transfers (checks-effects-interactions).
- **`SafeERC20`** used for the keeper-controlled `depositAsset` path (should fail loudly on a bad deposit — the graceful-degradation behavior above is specific to `redeem()`, where failing loudly would hurt holders, not the keeper).
- **Emergency pause exists but structurally cannot block an exit.** Both contracts have `pause()`/`unpause()` (owner-only). On the token, pause blocks ordinary transfers but **burns are unconditionally exempt** (`_update` checks `to != address(0)` before enforcing pause), which is exactly what `ReservedVault.redeem()` relies on. On the vault, pause blocks `depositAsset`/`registerReserveAsset` (new activity) but `redeem()` doesn't carry `whenNotPaused` at all — it's not merely unaffected by pause, it's structurally incapable of being paused. Proven by tests: pausing the token doesn't block `vault.redeem()`, and pausing the vault doesn't either. **Caveat:** most automated token scanners flag "has a pause function" as elevated risk regardless of this nuance — they generally can't reason about "but exits are carved out." Expect a lower automated trust score than a token with no pause at all; a human auditor reading the code should reach the opposite conclusion.
- **Timelock-ready ownership.** `Ownable2Step` accepts any address as owner, including a contract, so `scripts/deploy-timelock.ts` deploys OpenZeppelin's `TimelockController` (unmodified — see `vendor/TimelockController.sol`) and hands both contracts' ownership to it. Once that's done, every `onlyOwner` call (`setTaxBps`, `setTreasury`, `setAmmPair`, `setTaxExempt`, `pause`/`unpause`, `setKeeper`) requires `schedule()` then `execute()` after a delay (24h default) instead of taking effect instantly — "owner can instantly change fees" is one of the most commonly flagged patterns by security scanners. `test/Timelock.test.js` proves the delay is actually enforced (fast-forwards time rather than waiting real hours) and that a non-proposer can't schedule anything. **This is opt-in** — running `scripts/deploy.ts` alone leaves the deployer EOA as a direct, non-timelocked owner; you have to separately run `deploy-timelock.ts` against the deployed addresses to move to timelock-gated ownership.

**Still true regardless of any of the above:** none of this has been through a professional audit, and `PROJECT_BRIEF.md` requires one (plus securities-classification legal review) before any public/mainnet launch. Manual review, however careful, is not a substitute. Also, a timelock (and even a pause) only meaningfully help if the proposer/executor/pauser role sits with a multisig, not a single EOA — `deploy-timelock.ts` defaults both roles to the deployer for testnet convenience, with a `TODO` marking where to swap in a real multisig before mainnet.

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

1. `cp .env.example .env` and fill in `DEPLOYER_PRIVATE_KEY`, RPC URLs, and an Etherscan API key.
2. Edit `scripts/deploy.ts` — the owner/treasury/keeper addresses default to the deployer, which is only correct for a first testnet smoke deploy. Replace with your real multisig/treasury/keeper addresses before anything that touches mainnet.
3. `npm run deploy:testnet` (BSC testnet, chain id 97) or `npm run deploy:mainnet` (chain id 56).
4. After deploy: register the PancakeSwap RSVD/USDT pair via `token.setAmmPair(pair, true)`, and point the vault's `keeper` at the bot's operating address.
5. Optional but recommended before real value is at stake: `TOKEN_ADDRESS=<...> VAULT_ADDRESS=<...> npm run deploy:timelock:testnet` (or `:mainnet`) to move ownership behind a timelock (see Security above).

**Live on BSC testnet** (deployed and end-to-end tested — see `scripts/testnet-check.ts` — against buy/sell tax, burn, a mock bStock deposit, and redeem):

- `ReservedToken`: [`0x8761873C64C1fB8e8174b9Ee39f11FFe4a3D8883`](https://testnet.bscscan.com/address/0x8761873C64C1fB8e8174b9Ee39f11FFe4a3D8883)
- `ReservedVault`: [`0x0Ec27569eb6Ac155aE18161DF1F5332c8f8900ea`](https://testnet.bscscan.com/address/0x0Ec27569eb6Ac155aE18161DF1F5332c8f8900ea)

This predates the `Ownable2Step` / resilient-`redeem` hardening above — redeploy to testnet again before relying on it as a preview of the current contract behavior. No mainnet deploy has been run: that additionally needs the audit and securities-classification legal review `PROJECT_BRIEF.md` requires, neither of which has happened.

## What's not here yet

Per the brief's phased plan, this covers phase 1 (token + vault + tests) only:

- **Keeper bot** (Node/TypeScript, on-chain PancakeSwap swap path + Binance API fallback) — not built. Needs Binance API credentials and a funded operating wallet this session doesn't have.
- **PancakeSwap Infinity hook** — not built; see the tax-mechanism note above.
- **Governance/basket voting** — explicitly a later phase per the brief; not built.
- **Multisig ownership** — the timelock (`deploy-timelock.ts`) exists and is tested, but its proposer/executor roles, and the `keeper` address itself, are all still a single EOA on the current testnet deploy. A timelock behind one key delays a compromise, it doesn't prevent one — swap in a real multisig before mainnet.
- **Professional audit** — required by the brief before any public launch; hasn't happened. Everything in the Security section above is careful manual review, not a substitute.
