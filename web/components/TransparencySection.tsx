import { ShieldCheck, Lock, Landmark, Vault } from "lucide-react";
import { features } from "@/config/site";
import { FadeIn } from "./FadeIn";

const icons = [ShieldCheck, Lock, Landmark, Vault];

export function TransparencySection() {
  return (
    <section id="transparency" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">Transparency</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
            Verifiable, not trustless: the vault&apos;s on-chain balances are independently
            checkable at any time. The tokenized stocks themselves rely on Binance/BTech
            Holdings&apos; Abu Dhabi SPV custody one layer up — that&apos;s custodial trust the
            contracts don&apos;t remove.
          </p>
        </FadeIn>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {features.map((feature, i) => {
            const Icon = icons[i] ?? ShieldCheck;
            return (
              <FadeIn key={feature.title} delay={i * 0.08}>
                <div className="flex gap-4 rounded-lg border border-white/10 bg-white/5 p-6">
                  <Icon className="h-6 w-6 shrink-0 text-rsvd-gold" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">{feature.title}</div>
                    <p className="mt-1 text-sm text-rsvd-offwhite/60">{feature.description}</p>
                  </div>
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
    </section>
  );
}
