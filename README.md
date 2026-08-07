# Reserved contracts

Solidity contracts for an on-chain treasury on BNB Chain that acquires and holds
tokenized stocks (Binance bStocks) as backing for a fixed-supply token.

## Contracts

- **`ReservedToken.sol`** — fixed-supply BEP-20. 3% tax on transfers touching a registered
  AMM pair (buys and sells alike, symmetric by design), collected in-token and routed to
  the treasury. No mint function reachable after deploy, by anyone including the owner;
  supply only ever goes down via burns. Tax rate is owner-adjustable but hard-capped at 5%.
- **`ReservedVault.sol`** — holds the reserve assets. Any holder can burn their tokens at
  any time to redeem a pro-rata share of everything the vault holds. No owner withdraw
  path. `redeem()` deliberately carries no pause modifier, and burns are exempt from the
  token's pause, so an emergency stop can never block an exit.
- **`TreasuryConverterV2.sol`** — receives tax revenue and converts it into reserve assets.
  See "Design notes" below; this is the piece most worth a second pair of eyes.
- **`TreasuryConverter.sol`** — V1, superseded. Kept for diff/reference only. Its buy leg
  assumed a venue structure that turned out not to exist (see below). **Do not deploy.**
- **`ReservedGovernanceVote.sol`** — standalone, non-binding holder signalling on which
  asset the reserve should prioritise next. Has no access to the token, vault, or
  converter; it only reads balances to gate eligibility.
- **`vendor/TimelockController.sol`** — OpenZeppelin's, vendored. Ownership of the other
  contracts is intended to move behind this.

## Design notes — read before reviewing TreasuryConverterV2

The reserve assets are BEP-8056 "custodial model" tokens. Checked against mainnet, they
have **no PancakeSwap V2 or V3 pool at all** — not against USDT, not against WBNB, at any
fee tier. They settle through signed off-chain RFQ quotes against the issuer's own vault
contract, with only the stablecoin leg touching a public pool.

V1's buy leg read a V2 pair's cumulative-price accumulator for the target asset to derive
a TWAP price floor. That assumption is simply false for these tokens, and no address
change fixes it.

V2's response is deliberately *not* "add RFQ support" — binding the contract to one market
structure is what caused the problem, and doing it again guarantees a repeat. Instead the
buy leg is venue-agnostic: `acquireReserveAsset` forwards opaque calldata to an
owner-allowlisted target and judges the result purely by observed balance deltas, plus a
price floor derived from Chainlink feeds — deliberately independent of the venue, since a
venue can't vouch for its own price.

**What a compromised keeper key can and cannot do** is the property most worth attacking
in review:

- Cannot withdraw to itself or any wallet. Acquired assets are deposited into the vault
  atomically in the same transaction as the swap.
- Cannot sell the token below the TWAP floor, nor route it through the generic executor
  (`spendToken == token` is rejected, so the floor can't be sidestepped). The sell leg's
  TWAP reads the token/WBNB pair, which this project creates and funds itself — that pair
  is real, so that mechanism is sound.
- Cannot call arbitrary contracts — only owner-allowlisted targets, never the token, the
  vault, or the converter itself.
- Cannot drain by repetition: bounded per-transaction **and** by a rolling cumulative
  window per spend token.
- Cannot accept an arbitrarily bad quote where a feed is configured; the contract computes
  its own floor and takes the stricter of that and the keeper's `minAcquired`.
- **Can** choose execution timing and venue within those bounds. Where no feed is
  configured, price quality rests on the keeper's off-chain quote — `requireOracleFloor`
  defaults to fail-closed for exactly this reason.

### The migration escape hatch is a deliberate, contested tradeoff

V1 had no withdraw path of any kind. That reads well, but it meant BNB from the sell leg
could only ever leave via the buy leg — so the venue mismatch above would have permanently
bricked every converted BNB, unrecoverable by anyone.

V2 keeps "no path to a wallet" but removes permanent lockup: funds may move only to a
**contract**, only by the owner, only after a 7-day timelock, with the destination
announced on-chain in advance.

This is a real weakening and shouldn't be waved through: a malicious owner could deploy a
successor *with* a withdraw function and drain after the delay. The delay and public event
make that visible and contestable, not impossible. What actually closes it is the owner
being a timelock/multisig rather than a single key. **Reviewer input specifically wanted
here** — including "strip it and accept the lockup risk" as a legitimate answer.

## Known gaps — not oversights

- **No audit.** Everything above is careful design and testing, not a substitute.
- **Ownership is a single EOA** in all deploy scripts. The timelock exists and is tested,
  but a timelock behind one key delays a compromise, it doesn't prevent one. The migration
  hatch above assumes a multisig that isn't wired up yet.
- **The keeper bot cannot construct an RFQ buy.** The venue's ABI and quoting mechanism
  are unresolved, and it's unconfirmed whether it fills for contract counterparties at all
  (these are compliance-gated custodial tokens). If it only fills for EOAs, the automation
  path needs rethinking regardless of the contract.
- **Chainlink equity feeds** exist on BNB Chain for at least some of these underlyings,
  but the full set hasn't been confirmed. Assets without a feed are unbuyable while
  `requireOracleFloor` is on — which is the intended fail-closed behaviour.
- **`TreasuryConverterV2` has never been deployed to any chain,** including testnet.

## Compiling and testing

```bash
npm install
npm test          # offline solc compile, then the full suite
```

The repo compiles via `scripts/offline-compile.js` (npm `solc` directly, writing
Hardhat-format artifacts) rather than `hardhat compile`, so builds work without network
access. New contracts must be added to the `targets` list in that script.

111 tests currently passing.

## Deploying

1. `cp .env.example .env`, fill in the deployer key, RPC URL, and explorer API key.
2. `npm run deploy:mainnet` (or `:testnet`) — token + vault.
3. Create the AMM pair, then register it for tax via `set-amm-pair`.
4. `npm run deploy:treasury-converter-v2:mainnet` — see that script's header for the env
   vars it takes (spend caps, allowlisted swap targets, per-asset price feeds).
5. Move ownership behind the timelock/multisig **before** real value flows.

`scripts/verify-launch-addresses.ts` read-only-checks every external address the launch
depends on (router, factory, stablecoin, price feeds, reserve assets) against live
mainnet. Run it before wiring anything into the converter — every address in this repo
that came from a secondary source was confirmed with it rather than trusted.
