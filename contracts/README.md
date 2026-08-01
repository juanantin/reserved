# Reserved contracts

Solidity for RSVD, the fixed-supply BEP-20 token, and its vault of tokenized-stock (bStock) reserves. See [`../PROJECT_BRIEF.md`](../PROJECT_BRIEF.md) for the full architecture and brand brief.

## Contracts

- **`ReservedToken.sol`** — fixed-supply BEP-20. 3% tax (owner-adjustable, hard-capped at 5%) on transfers touching a registered AMM pair address; tax accrues in RSVD to `treasury`. `ERC20Burnable` gives `burn`/`burnFrom`, used by the vault on redemption. `Ownable2Step`.
- **`ReservedVault.sol`** — holds bStocks (plain BEP-20 tokens) deposited by the `keeper`. `redeem(amount)` burns the caller's RSVD (via `burnFrom`, so `approve` the vault first) and pays out a pro-rata share of every tracked reserve asset, computed against total supply *before* the burn. `Ownable2Step`.
- **`TreasuryConverter.sol`** — set as `ReservedToken.treasury` so tax revenue lands in a bounded contract instead of a wallet. Keeper-triggered `sellRsvd`/`buyReserveAsset`/`depositReserveAsset`, each capped and checked; no withdraw/rescue function exists. See "TreasuryConverter" under Security below.
- **`mocks/MockERC20.sol`**, **`mocks/MockERC20CustomDecimals.sol`**, **`mocks/MockRevertingERC20.sol`** — test-only stand-ins for bStocks/USDT (`MockRevertingERC20` always reverts on transfer, used to test redeem's failure handling; `MockERC20CustomDecimals` has a settable `decimals()`, used to test `TreasuryConverter`'s 18-decimal assertions against a non-18-decimal token). Never deployed to a real network.
- **`mocks/MockUniswapV2Pair.sol`**, **`mocks/MockUniswapV2Router.sol`**, **`mocks/MockChainlinkFeed.sol`** — test-only stand-ins for a PancakeSwap pair/router and a Chainlink price feed, with directly settable reserves, cumulative prices, swap output, and feed answer, so `TreasuryConverter`'s TWAP, Chainlink integration, and slippage logic can be tested against exact known values. Never deployed to a real network.
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

- **TreasuryConverter: the treasury is a contract, not a wallet.** Setting `token.treasury` to a plain EOA (what `deploy.ts` does by default) means whoever holds that key can do anything with accumulated tax revenue before it's converted — no on-chain constraint at all. `TreasuryConverter.sol` closes that gap: it receives tax revenue the same way (no change to collection), and only exposes three keeper-gated functions, each bounded:
  - `sellRsvd(amountIn, minOut)` — RSVD → BNB, capped by `maxRsvdSpendPerTx`, and checked against a genuine TWAP price floor computed from the RSVD/BNB pair's own cumulative-price accumulator (the standard UniswapV2 oracle pattern, not the spot price — spot price is exactly what a compromised keeper key, or anyone who can trigger a keeper-authorized call, could sandwich in a single transaction). The TWAP requires `minTwapWindow` (10 min default) to have elapsed since the last checkpoint, which also rate-limits how often this can be called.
  - `buyReserveAsset(bnbIn, minOut, targetToken, path)` — BNB → an owner-allowlisted bStock, capped by `maxBnbSpendPerTx`. Now has a real price floor: if the owner has configured a bStock/USDT pair (`setBStockUsdtPair`) and a Chainlink BNB/USD feed (`setPriceFeed`) for `targetToken`, the swap is bounded by a TWAP-derived floor the same way `sellRsvd` is — the bStock/USDT pair's own cumulative-price accumulator, converted to BNB terms via Chainlink's independent, off-chain-aggregated BNB/USD price (not a single AMM pool's spot price). `requirePriceFloorForBuys` defaults to `true`, so any allowlisted asset missing either piece of config makes `buyReserveAsset` revert (`PriceFloorNotConfigured`) rather than silently falling back to trusting the keeper's `minOut` alone — the owner has to deliberately turn that off per-deployment to accept the weaker guarantee. Both `USDT` and every configured bStock are asserted to use 18 decimals (reverting otherwise) rather than assumed.
  - `depositReserveAsset(token, amount)` — forwards an allowlisted asset into the vault. Also means `ReservedVault.keeper` should be set to the converter's own address, not an EOA — one less wallet with direct vault access.

  **No withdraw, rescue, or sweep function exists anywhere in the contract**, for the owner or anyone else — the same shape of guarantee `ReservedVault` already gives (see above). A compromised keeper key can only trigger bounded, price-checked, pre-allowlisted purchases into the vault; it cannot extract value. 56 tests in `test/TreasuryConverter.test.js` cover both TWAP paths (including below-floor swaps correctly reverting and at-floor ones succeeding), the Chainlink feed integration (including a non-positive `answer` reverting), the `requirePriceFloorForBuys` default and escape hatch, the 18-decimal assertions, every spend cap, the allowlist, and access control. **Opt-in**, same as the timelock — `deploy.ts` alone still leaves `treasury` as the deployer EOA; run `scripts/deploy-treasury-converter.ts` against an existing deployment to switch to it, then configure `setPriceFeed`/`setBStockUsdtPair` for each allowlisted bStock before relying on `buyReserveAsset`'s price floor.

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
6. Also recommended before real value is at stake: `TOKEN_ADDRESS=<...> VAULT_ADDRESS=<...> PAIR_ADDRESS=<...> USDT_ADDRESS=<...> npm run deploy:treasury-converter:testnet` (or `:mainnet`) to move the treasury off a wallet and into the bounded `TreasuryConverter` contract (see "TreasuryConverter" under Security above). `USDT_ADDRESS` defaults to BSC mainnet USDT if unset. Do this *before* the timelock handoff in step 5, or go through `schedule()`/`execute()` for the `setTreasury`/`setKeeper` calls it needs to make. Afterward, call `setPriceFeed`/`setBStockUsdtPair` for each allowlisted bStock — the deploy script prints the exact next steps.

**Live on BSC testnet** — redeployed after the security hardening above, end-to-end tested against buy/sell tax, burn, a mock bStock deposit, and redeem (`scripts/testnet-check.ts`, 7/7 passing), and with ownership handed to a timelock (`scripts/deploy-timelock.ts`), live-verified: the deployer's direct `pause()` call reverts, and `owner()` on both contracts equals the timelock:

- `ReservedToken`: [`0x58820a66D1871ad99313FBC2460DBD4693F50DE1`](https://testnet.bscscan.com/address/0x58820a66D1871ad99313FBC2460DBD4693F50DE1)
- `ReservedVault`: [`0x048Dc77edFBC733433ba3240D9d9b0140D863ECf`](https://testnet.bscscan.com/address/0x048Dc77edFBC733433ba3240D9d9b0140D863ECf)
- `TimelockController` (owner of both, 120s delay — testnet smoke-test value, not the 24h mainnet default): [`0x2E8EEB4F3db861Ecc85b2bb6478f215849033afc`](https://testnet.bscscan.com/address/0x2E8EEB4F3db861Ecc85b2bb6478f215849033afc)

Since ownership now sits with the timelock, any further admin changes (`setAmmPair`, `setTreasury`, etc.) on this deployment need to go through `timelock.schedule()` then `timelock.execute()` after the delay — a direct call from the deployer will revert, by design.

No mainnet deploy has been run: that additionally needs the audit and securities-classification legal review `PROJECT_BRIEF.md` requires, neither of which has happened.

## Mainnet dry run (throwaway ticker, self-funded only)

Before spending real money on an audit and the real `Reserved`/`RSVD` launch, it's reasonable to prove the whole path — deploy, verify, pool, tax, redeem — works end to end on mainnet itself, using a throwaway ticker and only your own capital. That's what this section covers. It is **not** a public launch: nobody but you should ever be expected to hold this test token.

**Ground rules, non-negotiable:**
- Use a throwaway name/symbol (e.g. `RSVDTEST`), never `Reserved`/`RSVD` — so nobody could mistake it for the real thing if they stumble on it.
- Fund it with the minimum that still exercises the real mechanism — not an amount you'd be upset to lose.
- Never post the pair address, contract address, or "come try this" anywhere public. Once a PancakeSwap pool exists on mainnet, it is public infrastructure regardless of whether you announce it — sniper bots watch the PancakeSwap factory's `PairCreated` event and can buy within the same block, with zero promotion on your part. This is a real, structural risk of this test, not a hypothetical: keep the pooled amounts small enough that sniping them isn't worth anyone's gas, and keep the pool's total lifetime short (create → your own test trades → remove liquidity, all in one sitting, not left sitting for days).
- Do all trading from wallets you control. Don't let a friend "try buying some" with their own money — the whole point of self-funded-only is that reclaiming the liquidity afterward can't leave anyone but you holding an illiquid bag.

**1. Deploy the test token + vault**, overriding the hardcoded name/symbol/supply via env vars instead of editing `deploy.ts`:

```bash
TOKEN_NAME=RSVDTEST TOKEN_SYMBOL=RSVDTEST FIXED_SUPPLY_TOKENS=1000000 npm run deploy:mainnet
```

A supply of 1,000,000 (vs. the real 1B) keeps the numbers small and obviously a test. This uses your real mainnet deployer wallet — never paste that wallet's private key into a chat session; edit `contracts/.env` directly on your own machine.

**2. Verify both contracts on BscScan** (`npx hardhat verify --network bscMainnet <address> <constructor args>` — same pattern as testnet) so the contract is readable, matching the "verifiable reserve" premise even for the test.

**3. Create the pool** with a small amount of your own token + BNB:

```bash
TOKEN_ADDRESS=<token address> POOL_TOKEN_AMOUNT=100000 POOL_BNB_AMOUNT=0.03 npm run pool:create:mainnet
```

`POOL_BNB_AMOUNT` is the real money at risk here — 0.03 BNB is a reasonable floor for a pool that's actually swappable without pathological slippage on small test trades, while staying small enough that sniping it isn't worth the gas. Check current BNB price yourself to know what that is in your currency. On top of that, budget roughly 0.02–0.03 BNB for gas across the two deploys, verification, `setAmmPair`, and a couple of test trades — so a mainnet wallet balance of ~0.06–0.08 BNB total is a reasonable minimum to have on hand before starting.

The script prints the resulting PancakeSwap pair address — save it, `remove-pool.ts` needs it later.

**4. Register the pair for tax** (from the deployer, before any timelock handoff — see the note atop `testnet-check.ts` for why order matters here):

```ts
await token.setAmmPair("<pair address>", true);
```

**5. Test buy/sell/tax/burn/redeem** using a second wallet you also control, sending it a little BNB for gas and swapping small amounts against the pool directly (e.g. via the PancakeSwap UI pointed at your pair, or scripted like `testnet-check.ts`). Confirm tax lands in `treasury`, `burn()` reduces supply, and (after depositing some real bStock into the vault, or another vault-registered token, via `depositAsset`) `redeem()` pays out correctly.

**6. Remove liquidity** once you're satisfied, reclaiming your BNB + remaining tokens:

```bash
TOKEN_ADDRESS=<token address> PAIR_ADDRESS=<pair address> npm run pool:remove:mainnet
```

After this, the test pool is empty and effectively dead — nobody can meaningfully trade against it anymore. The test token contract itself keeps existing on-chain (nothing here self-destructs it), which is fine: it's worthless and unpooled.

**7. Deploy the real thing separately.** This dry run doesn't upgrade into the real launch — once you're confident, deploy fresh with the real `Reserved`/`RSVD` name (default env, no overrides needed), a real multisig for owner/treasury/keeper (not the solo deployer key used here), and — per `PROJECT_BRIEF.md` — only after the audit and legal review it requires.

## What's not here yet

Per the brief's phased plan, this covers phase 1 (token + vault + tests) only:

- **Keeper bot** (Node/TypeScript, scheduling + Binance API fallback for bStock sourcing) — not built. `TreasuryConverter.sol` now provides the *on-chain* side (bounded swap/deposit functions a keeper can call), but nothing yet decides *when* to call them or sources bStocks via Binance's API when on-chain slippage is too high. Needs Binance API credentials and a funded operating wallet this session doesn't have.
- **PancakeSwap Infinity hook** — not built; see the tax-mechanism note above.
- **Governance/basket voting** — explicitly a later phase per the brief; not built.
- **Multisig ownership** — the timelock (`deploy-timelock.ts`) exists and is tested, but its proposer/executor roles, and the `keeper` address itself, are all still a single EOA on the current testnet deploy. A timelock behind one key delays a compromise, it doesn't prevent one — swap in a real multisig before mainnet.
- **Professional audit** — required by the brief before any public launch; hasn't happened. Everything in the Security section above is careful manual review, not a substitute.
