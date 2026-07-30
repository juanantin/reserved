import { tokenInfo } from "@/config/token";
import { CopyAddressButton } from "./CopyAddressButton";

const stats = [
  { label: "Fixed supply", value: `${tokenInfo.fixedSupply} ${tokenInfo.ticker}` },
  { label: "Buy/sell tax", value: `${tokenInfo.taxBps / 100}%` },
  { label: "Chain", value: tokenInfo.chain },
];

export function TreasurySection() {
  return (
    <section id="treasury" className="border-t border-white/10 bg-rsvd-navy px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold md:text-4xl">Treasury</h2>
        <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
          The vault holds every tokenized stock the reserve has acquired. Its balances are
          checkable on-chain, block by block, once the contracts are deployed — this section
          will show live figures then, not before.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-white/10 bg-rsvd-black/40 p-6">
              <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{stat.label}</div>
              <div className="mt-2 text-2xl font-semibold text-rsvd-gold">{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <CopyAddressButton address={tokenInfo.tokenAddress} label="RSVD token contract" />
          <CopyAddressButton address={tokenInfo.vaultAddress} label="Vault contract" />
        </div>
      </div>
    </section>
  );
}
