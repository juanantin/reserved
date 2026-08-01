import { tokenInfo } from "@/config/token";
import { FadeIn } from "./FadeIn";
import { BNBLogo } from "./icons/BNBLogo";
import { dictionaries, type Locale } from "@/lib/i18n";

export function TokenomicsSection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].tokenomics;

  const tokenomics = [
    { key: "ticker", label: t.labels.ticker, value: tokenInfo.ticker },
    { key: "chain", label: t.labels.chain, value: tokenInfo.chain },
    { key: "fixedSupply", label: t.labels.fixedSupply, value: `${tokenInfo.fixedSupply} ${tokenInfo.ticker}` },
    { key: "buyTax", label: t.labels.buyTax, value: `${tokenInfo.taxBps / 100}%` },
  ];

  return (
    <section id="tokenomics" className="border-t border-white/10 px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <h2 className="text-3xl font-bold md:text-4xl">{t.title}</h2>
          <p className="mt-3 max-w-2xl text-rsvd-offwhite/70">
            {t.descriptionPrefix}{" "}
            <a href="#treasury" className="text-rsvd-gold underline-offset-4 hover:underline">
              {t.descriptionLink}
            </a>{" "}
            {t.descriptionSuffix}
          </p>
        </FadeIn>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {tokenomics.map((fact, i) => (
            <FadeIn key={fact.key} delay={i * 0.06} className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
              <div className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-rsvd-gold">
                {fact.key === "chain" && <BNBLogo className="h-4 w-4 shrink-0" />}
                {fact.value}
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
