import { tokenInfo } from "@/config/token";
import { CopyAddressButton } from "./CopyAddressButton";
import { BackingGrid } from "./BackingGrid";
import { ReserveCoins } from "./ReserveCoins";
import { FadeIn } from "./FadeIn";
import { LiveTreasuryStats } from "./LiveTreasuryStats";
import { RedeemPanel } from "./RedeemPanel";
import { BlockchainBackground } from "./BlockchainBackground";
import { dictionaries, type Locale } from "@/lib/i18n";

export function TreasurySection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].treasury;

  return (
    <section id="treasury" className="relative overflow-hidden border-t border-white/10 px-6 py-20">
      <BlockchainBackground className="pointer-events-none absolute inset-0 h-full w-full opacity-40" />
      <div className="relative mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">{t.title}</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">{t.description(tokenInfo.ticker)}</p>
        </FadeIn>

        <FadeIn delay={0.1} className="mt-6">
          <RedeemPanel locale={locale} />
        </FadeIn>

        {tokenInfo.tokenAddress && tokenInfo.vaultAddress ? (
          <LiveTreasuryStats locale={locale} />
        ) : (
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {t.staticFacts.map((fact, i) => (
              <FadeIn key={fact.label} delay={i * 0.08} className="rounded-lg border border-white/10 bg-white/5 p-6">
                <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
                <div className="mt-2 text-lg font-semibold text-rsvd-gold">{fact.value}</div>
              </FadeIn>
            ))}
          </div>
        )}

        <FadeIn delay={0.2} className="mt-6 grid gap-3 sm:grid-cols-2">
          <CopyAddressButton address={tokenInfo.tokenAddress} label={t.tokenContract} locale={locale} />
          <CopyAddressButton address={tokenInfo.vaultAddress} label={t.vaultContract} locale={locale} />
        </FadeIn>

        <FadeIn delay={0.24} className="mt-6 rounded-lg border border-white/10 bg-white/5 p-6">
          <h3 className="text-sm uppercase tracking-widest text-rsvd-offwhite/40">{t.reserveAssets}</h3>
          <div className="mt-5">
            <BackingGrid locale={locale} />
          </div>
        </FadeIn>

        <FadeIn delay={0.3} className="mt-10 flex justify-center">
          <ReserveCoins />
        </FadeIn>
      </div>
    </section>
  );
}
