# Reserved — project brief

An on-chain treasury on BNB Chain that acquires and holds tokenized stocks (Binance bStocks) for the long term. Fixed-supply token, trade tax funds the reserve, holders redeem pro-rata on-chain. Modeled on backed.is (Robinhood Chain + Rialto), rebuilt for BNB Chain + Binance's own bStocks — no third-party liquidity venue needed.

## Brand

- **Name:** Reserved
- **Tagline:** "Real stocks. On-chain. Reserved."
- **Ticker:** RSVD
- **Palette:** gold #D4AF37, navy #0D1B2A / #1B263B, near-black #0A0A14, off-white #F5F5F5
- **Font:** Sora
- **Mark:** R monogram with ascending bars built into the leg of the R (encodes the rising-floor mechanic)

### Copy (accuracy-checked — use these, not earlier overclaimed drafts)

- Reserved is an on-chain treasury that acquires and holds tokenized stocks for the long term. *(no "decentralized" — treasury is keeper-operated at launch, not DAO-governed)*
- **Real stocks** — Invested in tokenized equities issued via Binance's bStocks.
- **Verifiable reserve** — Vault holdings checkable on-chain, block by block. Underlying share custody tracked via Binance's daily Proof of Collateral. *(two distinct guarantees — don't collapse into one "100% on-chain" claim)*
- **Built to last** — Long-term treasury, designed to compound value over time.
- **100% Reserved** — Vault assets 1:1 backed by tokenized stocks, verified via Binance Proof of Collateral.
- **Basket governance** — Token holders vote which stocks the reserve buys. *(a real, buildable feature — don't claim general "community owned" beyond this)*

## Architecture

1. **Token** — fixed-supply BEP-20, burn-on-redeem (deflationary supply).
2. **Tax hook** — 3% buy/sell tax via a PancakeSwap Infinity hook (BNB Chain's equivalent of the Uniswap v4 hook backed.is uses), proceeds in BNB/USDT routed to the keeper.
3. **Keeper bot** — two paths, try on-chain first:

   - Primary: swap BNB/USDT for bStocks directly via PancakeSwap bStocks/USDT pools (NVDAB, TSLAB, CRCLB, MUB, SNDKB, + more added since launch). Fully atomic, on-chain.
   - Fallback: if on-chain slippage exceeds a threshold (pools are still young), buy via Binance API and withdraw the BEP-20 bStocks to the vault address. Slower, but lands on-chain either way.
4. **Vault contract** — holds bStocks as BEP-20 tokens; redeemable pro-rata by burning the Reserved token. Balance inspectable on BscScan.
5. **Governance (later phase)** — token holders vote on which bStocks the reserve acquires.

## Reference model: backed.is ($BACKED on Robinhood Chain)

Reserved's mechanic is a direct port of backed.is, retargeted from Robinhood Chain to BNB Chain:

- Fixed-supply token, 3% buy/sell tax taken via a Uniswap v4 hook, paid in ETH.
- A keeper spends that ETH buying tokenized blue-chip stocks, routed through Rialto (Robinhood Chain's liquidity venue).
- Stocks sit in a vault as backing; token is redeemable any time for a pro-rata share of the vault.
- Tagline: "It can't go to zero."

Reserved swaps: Robinhood Chain → BNB Chain, Uniswap v4 hook → PancakeSwap Infinity hook, ETH → BNB/USDT, Rialto → PancakeSwap bStocks/USDT pools (with a Binance API fallback since those pools are newer/thinner). The verified backed.is source was not available to diff against directly (fetching backed.is / the Robinhood Chain explorer was blocked from the build environment) — this implementation is reconstructed from the mechanic described above and the brief below, not copied line-for-line. Re-verify against backed.is's actual deployed source before mainnet launch.

## Known constraints — don't let marketing outrun these

- bStocks backing ultimately depends on Binance/BTech Holdings' Abu Dhabi SPV custody — this is custodial trust one layer up, not full decentralization. Say "verifiable reserve," not "trustless."
- On-chain PancakeSwap liquidity for bStocks pairs may be thin for large buys — keeper needs slippage-aware routing, not a naive on-chain-only swap.
- Not community-governed at launch unless basket voting is actually shipped — don't ship "Community Owned" copy before it's true.
- Token represents a claim on a reserve of real securities exposure — flag for counsel review on securities classification before any public launch or listing push.

## Suggested build phases

1. Solidity: token contract, tax hook, vault/redeem logic, tests (Foundry or Hardhat).
2. Keeper bot (Node/TypeScript): on-chain swap path first — reuse patterns from the existing FARTCOIN bot infra on the Oracle VPS.
3. Keeper bot: Binance API fallback path (buy + withdraw to vault).
4. Frontend: treasury dashboard, buy/sell widget, vault/proof page — brand tokens above.
5. Testnet deploy, audit pass, then mainnet.
