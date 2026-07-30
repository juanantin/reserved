import { ShieldCheck, Lock, Landmark, Vault } from "lucide-react";
import { features } from "@/config/site";

const icons = [ShieldCheck, Lock, Landmark, Vault];

export function TransparencySection() {
  return (
    <section id="transparency" className="border-t border-white/10 bg-rsvd-navy px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-3xl font-bold md:text-4xl">Transparency</h2>
        <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
          Verifiable, not trustless: the vault&apos;s on-chain balances are independently
          checkable at any time. The tokenized stocks themselves rely on Binance/BTech
          Holdings&apos; Abu Dhabi SPV custody one layer up — that&apos;s custodial trust the
          contracts don&apos;t remove.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {features.map((feature, i) => {
            const Icon = icons[i] ?? ShieldCheck;
            return (
              <div key={feature.title} className="flex gap-4 rounded-lg border border-white/10 bg-rsvd-black/40 p-6">
                <Icon className="h-6 w-6 shrink-0 text-rsvd-gold" aria-hidden="true" />
                <div>
                  <div className="font-semibold">{feature.title}</div>
                  <p className="mt-1 text-sm text-rsvd-offwhite/60">{feature.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
