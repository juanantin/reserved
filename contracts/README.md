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
  The piece most worth a second pair of eyes; see "Design notes" below.
- **`TreasuryConverter.sol`** — V1, superseded. Kept for diff/reference only. **Do not
  deploy.** Its buy leg assumed a venue structure that does not exist.
- **`ReservedGovernanceVote.sol`** — standalone, non-binding holder signalling on which
  asset the reserve should prioritise next. No access to the token, vault, or converter; it
  only reads balances to gate eligibility.
- **`RfqProbe.sol`** — throwaway mainnet diagnostic, not part of the system. See "What the
  probe established" below.
- **`vendor/TimelockController.sol`** — OpenZeppelin's, vendored. Ownership of the other
  contracts is intended to move behind this.

## Design notes — read before reviewing TreasuryConverterV2

The reserve assets are BEP-8056 "custodial model" tokens. Verified against mainnet, they
have **no PancakeSwap V2 or V3 pool at all** — not against USDT, not against WBNB, at any
fee tier. They settle through signed off-chain RFQ quotes against the issuer's own vault
contract, with only the stablecoin leg touching a public pool.

V1's buy leg read a V2 pair's cumulative-price accumulator for the target asset to derive
a TWAP price floor. That assumption is simply false for these tokens, and no address change
fixes it.

V2's response is deliberately *not* "add RFQ support" — binding the contract to one market
structure is what caused the problem, and repeating it guarantees another rediscovery.
Instead the buy leg is venue-agnostic: `acquireReserveAsset` forwards opaque calldata to an
owner-allowlisted target and judges the result purely by observed balance deltas, plus a
price floor derived from Chainlink feeds — deliberately independent of the venue, since a
venue can't vouch for its own price.

### What the probe established

`RfqProbe.sol` was deployed to mainnet and used to replay a captured bStock swap from a
contract rather than an EOA. It reverted with `QuoteExpired()` (selector `0x8727a7f9`,
keccak-confirmed) — meaning the call passed through the router, through route parsing, into
the RFQ settlement contract, and failed only at the quote-validity check.

**It was not rejected for being a contract.** Strong evidence the executor design works
against the real venue. Not proof: the settlement contract's source isn't available, so a
taker check could sit after the expiry check and simply never have been reached. Only a
fresh, valid quote submitted from a contract settles it.

Quote validity windows observed on-chain were **40 seconds**, which means automation
requires a live quote API — there is no version where a human pastes calldata in time.
Whether such an API exists is unresolved and is currently the single blocker on automated
buying.

### What a compromised keeper key can and cannot do

The property most worth attacking in review:

- Cannot withdraw to itself or any wallet. Acquired assets are deposited into the vault
  atomically in the same transaction as the swap.
- Cannot sell the token below the TWAP floor, nor route it through the generic executor
  (`spendToken == token` is rejected, so the floor can't be sidestepped). The sell leg's
  TWAP reads the token/WBNB pair, which this project creates and funds itself — that pair
  is real, so that mechanism is sound and was carried over from V1 unchanged.
- Cannot call arbitrary contracts — only owner-allowlisted targets, never the token, the
  vault, or the converter itself.
- Cannot drain by repetition: bounded per-transaction **and** by a rolling cumulative
  window per spend token. (V1 had only a per-tx cap, which a compromised key could call in
  a loop within one block.)
- Cannot accept an arbitrarily bad quote where a feed is configured; the contract computes
  its own floor and takes the stricter of that and the keeper's `minAcquired`.
- **Can** choose execution timing and venue within those bounds. Where no feed is
  configured, price quality rests on the keeper's off-chain quote — `requireOracleFloor`
  defaults to fail-closed for exactly this reason.

### No withdraw, and no migration either — decided, not overlooked

An earlier V2 draft carried an owner-only migration hatch (move everything to a successor
*contract* after a 7-day timelock) to avoid V1's real hazard: BNB from `sellRsvd` could only
leave via the buy leg, so the venue mismatch above would have permanently bricked every
converted BNB.

It was **removed**, because stranding has a cheaper answer that costs no trust: wrap the
stranded BNB and deposit it into the vault as backing, using the executor itself.

```
acquireReserveAsset(address(0), amount, WBNB, hex"d0e30db0", WBNB, amount)
```

`WBNB.deposit()` mints 1:1, the balance-delta check passes, and the proceeds land in the
vault as redeemable backing. Replacing the converter itself needs no hatch either: empty it
this way, deploy a fresh one, repoint `setTreasury`/`setKeeper`.

Migration would have bought a narrow edge case in exchange for a permanent owner-drain
vector — a malicious successor can ship a withdraw function of its own, so the delay makes
that visible, not impossible. Bad trade when the edge case is already covered.

The recovery path has its own tests (`MockWBNB`, three cases including that recovered WBNB
is *redeemable* rather than merely parked), and the "no path to a wallet" test now rejects
the migration function names so reintroducing them fails the suite.

**Reviewer input still welcome on this** — it was argued both ways before landing here.

## Known gaps — not oversights

- **No audit.** Everything above is careful design and testing, not a substitute. For
  calibration: V1 shipped with 70 passing tests and still had a wrong venue assumption plus
  three real defects (no oracle staleness check, no rate limiting beyond per-tx, a standing
  router allowance). Tests verify what someone thought to check.
- **Ownership is a single EOA** in all deploy scripts. The timelock exists and is tested,
  but a timelock behind one key delays a compromise, it doesn't prevent one.
- **`TreasuryConverterV2` has never been deployed to any chain**, including testnet.
- **The keeper bot cannot construct an RFQ buy** — blocked on the quote API above. Its
  Binance API fallback (`keeper/src/binanceFallback.ts`) throws unconditionally; it is
  scaffolding, never implemented against a real account.
- **Chainlink equity feeds** exist on BNB Chain for at least some underlyings (NVDA and
  TSLA confirmed to exist; full set unconfirmed). Assets without a feed are unbuyable while
  `requireOracleFloor` is on — intended fail-closed behaviour.

## Compiling and testing

```bash
npm install
npm test
```

Builds via `scripts/offline-compile.js` (npm `solc` directly, writing Hardhat-format
artifacts) rather than `hardhat compile`, so it works without network access. New contracts
must be added to the `targets` list in that script.

**107 tests currently passing.**

## Deploying

1. `cp .env.example .env`, fill in the deployer key, RPC URL, explorer API key.
2. `npm run deploy:mainnet` (or `:testnet`) — token + vault.
3. Create the AMM pair, then register it for tax via `set-amm-pair`.
4. `npm run deploy:treasury-converter-v2:mainnet` — see that script's header for the env
   vars it takes (spend caps, allowlisted swap targets, per-asset price feeds).
5. Move ownership behind the timelock/multisig **before** real value flows.

`scripts/verify-launch-addresses.ts` read-only-checks every external address the launch
depends on (router, factory, stablecoin, price feeds, reserve assets) against live mainnet.
Run it before wiring anything into the converter — every address in this repo that came
from a secondary source was confirmed with it rather than trusted.
