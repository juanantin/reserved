import { tokenInfo } from "@/config/token";
import { CopyAddressButton } from "./CopyAddressButton";
import { AllocationDonut } from "./AllocationDonut";
import { FadeIn } from "./FadeIn";

const facts = [
  { label: "Reserve assets held", value: "None yet" },
  { label: "Redemption", value: "Pro-rata, on-chain, any time" },
  { label: "Custody", value: "Binance Proof of Collateral" },
];

function RedeemButton() {
  if (tokenInfo.redeemUrl) {
    return (
      <a
        href={tokenInfo.redeemUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-md bg-rsvd-gold px-6 py-3 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold"
      >
        Redeem RSVD
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled
      title="Redeem opens once the vault contract is deployed"
      className="cursor-not-allowed rounded-md border border-rsvd-gold/30 px-6 py-3 text-sm font-semibold text-rsvd-gold/50"
    >
      Redeem — Coming Soon
    </button>
  );
}

export function TreasurySection() {
  return (
    <section id="treasury" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">Treasury</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
            The vault holds every tokenized stock the reserve has acquired. Its balances are
            checkable on-chain, block by block, once the contracts are deployed — this section
            will show live figures then, not before. Any {tokenInfo.ticker} holder can burn
            {" "}{tokenInfo.ticker} at any time to redeem their pro-rata share of everything the
            vault holds — no permission, no waiting period.
          </p>
        </FadeIn>

        <FadeIn delay={0.1} className="mt-6">
          <RedeemButton />
        </FadeIn>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {facts.map((fact, i) => (
            <FadeIn key={fact.label} delay={i * 0.08} className="rounded-lg border border-white/10 bg-white/5 p-6">
              <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
              <div className="mt-2 text-lg font-semibold text-rsvd-gold">{fact.value}</div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.2} className="mt-6 grid gap-3 sm:grid-cols-2">
          <CopyAddressButton address={tokenInfo.tokenAddress} label="RSVD token contract" />
          <CopyAddressButton address={tokenInfo.vaultAddress} label="Vault contract" />
        </FadeIn>

        <FadeIn delay={0.28} className="mt-6 rounded-lg border border-white/10 bg-white/5 p-6">
          <h3 className="text-sm uppercase tracking-widest text-rsvd-offwhite/40">
            Planned reserve assets
          </h3>
          <div className="mt-5">
            <AllocationDonut />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
