import { ArrowUpRight } from "lucide-react";
import { tokenInfo } from "@/config/token";
import { FadeIn } from "./FadeIn";
import { BNBLogo } from "./icons/BNBLogo";
import { BlockchainBackground } from "./BlockchainBackground";
import { dictionaries, type Locale } from "@/lib/i18n";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function TokenomicsSection({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].tokenomics;
  const bscscanUrl = tokenInfo.tokenAddress ? `${tokenInfo.explorerBaseUrl}${tokenInfo.tokenAddress}` : "";

  const tokenomics = [
    { key: "ticker", label: t.labels.ticker, value: tokenInfo.ticker },
    { key: "chain", label: t.labels.chain, value: tokenInfo.chain },
    { key: "fixedSupply", label: t.labels.fixedSupply, value: `${tokenInfo.fixedSupply} ${tokenInfo.ticker}` },
    { key: "transferTax", label: t.labels.transferTax, value: "None" },
    { key: "swapFee", label: t.labels.swapFee, value: `${tokenInfo.poolFeeBps / 100}%` },
    {
      key: "protocolFee",
      label: t.labels.protocolFee,
      // Flagged rather than stated flat: the hook ships after the pool, and a site
      // asserting a fee that is not yet charged is just wrong.
      value: `${tokenInfo.protocolFeeBps / 100}%${tokenInfo.protocolFeeLive ? "" : " (at launch of the hook)"}`,
    },
    { key: "contract", label: t.labels.contract, value: bscscanUrl ? shortAddr(tokenInfo.tokenAddress) : "—" },
  ];

  return (
    <section id="tokenomics" className="relative overflow-hidden border-t border-white/10 px-6 py-20">
      <BlockchainBackground className="pointer-events-none absolute inset-0 h-full w-full opacity-40" />
      <div className="relative mx-auto max-w-6xl">
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

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {tokenomics.map((fact, i) =>
            fact.key === "contract" && bscscanUrl ? (
              <FadeIn key={fact.key} delay={i * 0.06}>
                <a
                  href={bscscanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-white/10 bg-white/5 p-4 transition-colors hover:border-rsvd-gold focus-gold"
                >
                  <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
                  <div className="mt-1 flex items-center gap-1 font-mono text-lg font-semibold text-rsvd-gold">
                    {fact.value}
                    <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </div>
                </a>
              </FadeIn>
            ) : (
              <FadeIn key={fact.key} delay={i * 0.06} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-widest text-rsvd-offwhite/40">{fact.label}</div>
                <div className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-rsvd-gold">
                  {fact.key === "chain" && <BNBLogo className="h-4 w-4 shrink-0" />}
                  {fact.value}
                </div>
              </FadeIn>
            )
          )}
        </div>
      </div>
    </section>
  );
}
