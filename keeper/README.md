# Reserved keeper bot

Off-chain Node/TypeScript service that periodically calls `TreasuryConverter`'s bounded,
price-checked functions — it decides *when* to sell accrued RSVD for BNB and *when* to
buy allowlisted bStocks with that BNB, then deposit them into the vault. See
[`../contracts/contracts/TreasuryConverter.sol`](../contracts/contracts/TreasuryConverter.sol)
and its Security section in [`../contracts/README.md`](../contracts/README.md) for what
the contract itself enforces regardless of what this bot does.

## What this bot can and can't do

The wallet this bot runs as (`TreasuryConverter.keeper`, or its owner) can only ever
trigger `sellRsvd`, `buyReserveAsset`, and `depositReserveAsset` — each capped by a
per-tx spend limit, checked against a TWAP (and, for buys, a Chainlink price feed) price
floor, and (for buys/deposits) restricted to an owner-allowlisted set of tokens. **There
is no function on the contract this bot could call to withdraw or redirect funds**, even
if its private key were compromised. Protect the key anyway — a compromised key can
still force conversions at the worst allowed moment within those bounds.

## Each cycle

1. Reads the converter's RSVD balance. If above `MIN_RSVD_TO_SELL`, checks the RSVD/BNB
   TWAP checkpoint: if it's never been set or the window hasn't elapsed yet, records/waits
   instead of calling `sellRsvd` (which would just revert). Otherwise sells up to
   `maxRsvdSpendPerTx`, trusting the contract's own TWAP floor (passes `minOut=0` —
   see "On minOut" below).
2. For each configured bStock (`BSTOCKS` env var): checks it's allowlisted on-chain, has
   a configured USDT pair + Chainlink feed (or that `requirePriceFloorForBuys` has been
   turned off), and that its TWAP checkpoint is ready. Simulates the buy first
   (`staticCall`, no gas, no state change) — if that fails, likely because on-chain
   liquidity is too thin for the size, falls through to the Binance API fallback
   (**not implemented**, see below) instead of endlessly retrying a doomed transaction.
   Otherwise executes the real buy, then deposits whatever it received into the vault.

## On `minOut`

The bot passes `minOut=0` (well, `keeperMinOut=0`) to both `sellRsvd` and
`buyReserveAsset`, deliberately leaving the real price protection to the contract's own
on-chain TWAP/Chainlink floor rather than computing a second, independent off-chain
quote and passing that instead. The contract already takes the *stricter* of the two
values (see `TreasuryConverter.sol`), so this isn't a gap — it's not duplicating a
price check the contract does better anyway. If you want the bot to also enforce a
tighter floor from its own price source, that's a real (currently unbuilt) enhancement,
not a missing safety feature.

## Binance API fallback — not implemented

[`src/binanceFallback.ts`](src/binanceFallback.ts) is wired into the main loop (it's
the real call site a working implementation would replace) but the function itself
throws unconditionally. Implementing it for real means: signed Binance spot REST calls,
handling partial fills, respecting rate limits, and a withdrawal flow to the vault
address (which typically requires an allowlisted withdrawal address and may need manual
2FA approval depending on account settings) — none of which has been built or tested
against a live Binance account, because this project has never had Binance API
credentials. Treat this as scaffolding to implement against a real account, not a proven
path.

## Running

```bash
npm install
cp .env.example .env   # fill in RPC_URL, KEEPER_PRIVATE_KEY, CONVERTER_ADDRESS, RSVD_ADDRESS, BSTOCKS
npm run once            # one cycle, then exit — good for cron or a manual check
npm start                # after `npm run build`, or `npm run dev` to run TypeScript directly in a loop
```

`WBNB` is deliberately not an env var — the bot reads it on-chain from
`converter.WBNB()` (which `TreasuryConverter` itself resolved from the router at deploy
time) rather than trusting a second hand-typed copy of the address.

## Nonce handling

A single cycle can send several transactions back to back (sell, then a checkpoint +
buy + deposit per bStock). The bot wraps its signer in ethers' `NonceManager` rather
than re-querying the node's "pending" nonce before every send — on a fast/automining
chain (verified locally against a Hardhat node), the "pending" nonce can lag by one
right after a transaction mines, causing the next send to reuse a stale nonce and
revert. `NonceManager` tracks it locally instead.

## Verification

This has been run end-to-end against a real deployed `TreasuryConverter` on a local
Hardhat node (mock router/pair/feed, not a PancakeSwap fork) — confirmed: `sellRsvd`
executes when the RSVD balance and TWAP window allow it, `buyReserveAsset` executes and
the bought bStock lands in the converter, `depositReserveAsset` then moves it into the
vault (`vault.isReserveAsset(bStock)` becomes `true`, balance confirmed on the vault),
and a too-thin-liquidity buy correctly falls through to the (intentionally unimplemented)
Binance fallback instead of crashing the loop. It has **not** been run against real BSC
testnet/mainnet infrastructure or a real Binance account — do that before trusting it
with real funds.
