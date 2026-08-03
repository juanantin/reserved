import { ShieldCheck, Lock, Landmark, Vault, ArrowUpRight } from "lucide-react";
import { tokenInfo } from "@/config/token";
import { FadeIn } from "./FadeIn";
import { dictionaries, type Locale } from "@/lib/i18n";

const icons = [ShieldCheck, Lock, Landmark, Vault];

// "Verifiable reserve" (index 1) is the one claim among these that has a real,
// checkable on-chain artifact — the vault contract itself — so it's the one that
// gets the actual explorer link, only rendered once there's a real address to point
// at (never a placeholder/fabricated link before the vault is deployed).
const VERIFIABLE_RESERVE_INDEX = 1;

export function TransparencySection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].transparency;
  const vaultExplorerUrl = tokenInfo.vaultAddress ? `${tokenInfo.explorerBaseUrl}${tokenInfo.vaultAddress}` : "";

  return (
    <section id="transparency" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">{t.title}</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">{t.description}</p>
        </FadeIn>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {t.features.map((feature, i) => {
            const Icon = icons[i] ?? ShieldCheck;
            return (
              <FadeIn key={feature.title} delay={i * 0.08}>
                <div className="flex gap-4 rounded-lg border border-white/10 bg-white/5 p-6">
                  <Icon className="h-6 w-6 shrink-0 text-rsvd-gold" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">{feature.title}</div>
                    <p className="mt-1 text-sm text-rsvd-offwhite/60">{feature.description}</p>
                    {i === VERIFIABLE_RESERVE_INDEX && vaultExplorerUrl && (
                      <a
                        href={vaultExplorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-rsvd-gold transition-colors hover:text-rsvd-gold/80 focus-gold"
                      >
                        {t.viewVaultOnChain}
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
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
