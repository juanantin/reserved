import { StatusBadge } from "./StatusBadge";
import { Logo } from "./Logo";
import { FadeIn } from "./FadeIn";
import { tokenInfo } from "@/config/token";

export function Hero() {
  return (
    <section id="top" className="bg-grid relative overflow-hidden px-6 pb-24 pt-20 md:pt-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <div className="flex flex-col items-start gap-6">
          <FadeIn delay={0}>
            <StatusBadge />
          </FadeIn>

          <FadeIn delay={0.08}>
            <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl">
              The on-chain treasury of{" "}
              <span className="text-gradient-gold">tokenized stocks.</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.16}>
            <p className="text-lg font-medium text-rsvd-offwhite/90">
              We acquire. We hold. We grow.
              <br />
              Transparent. Verifiable. Reserved.
            </p>
          </FadeIn>

          <FadeIn delay={0.24}>
            <p className="max-w-xl text-sm text-rsvd-offwhite/60">
              Reserved is an on-chain treasury that acquires and holds tokenized stocks for the
              long term, on {tokenInfo.chain}. Every {tokenInfo.ticker} buy and sell funds the
              reserve; every holder can redeem their pro-rata share, on-chain, any time.
            </p>
          </FadeIn>

          <FadeIn delay={0.32}>
            <div className="flex flex-wrap gap-4 pt-2">
              <a
                href="#treasury"
                className="rounded-md bg-rsvd-gold px-6 py-3 text-sm font-semibold text-rsvd-black transition-opacity hover:opacity-90 focus-gold"
              >
                View Treasury
              </a>
              <a
                href="#vault"
                className="rounded-md border border-white/20 px-6 py-3 text-sm font-semibold text-rsvd-offwhite transition-colors hover:border-rsvd-gold hover:text-rsvd-gold focus-gold"
              >
                View Vault
              </a>
            </div>
          </FadeIn>

          <FadeIn delay={0.4}>
            <p className="pt-4 text-xs uppercase tracking-widest text-rsvd-offwhite/40">
              Real stocks. On-chain. Reserved.
            </p>
          </FadeIn>
        </div>

        <FadeIn delay={0.2} className="relative mx-auto hidden md:block">
          <div
            className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(212,175,55,0.35) 0%, transparent 70%)" }}
            aria-hidden="true"
          />
          <Logo size={280} className="mx-auto" />
        </FadeIn>
      </div>
    </section>
  );
}
