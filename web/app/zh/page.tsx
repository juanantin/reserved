import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { TokenomicsSection } from "@/components/TokenomicsSection";
import { TreasurySection } from "@/components/TreasurySection";
import { TransparencySection } from "@/components/TransparencySection";
import { GovernanceSection } from "@/components/GovernanceSection";
import { FeatureStrip } from "@/components/FeatureStrip";
import { Footer } from "@/components/Footer";

const title = "Reserved (RSVD) — 真实股票，链上运行，稳健守护。";
const description = "Reserved 是一个链上资金库，长期收购并持有代币化股票，运行于 BNB Chain。";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/zh", languages: { en: "/", "zh-Hans": "/zh" } },
  openGraph: { title, description, type: "website", images: ["/images/social-preview.svg"] },
  twitter: { card: "summary_large_image", title, description, images: ["/images/social-preview.svg"] },
};

export default function HomeZh() {
  return (
    <>
      <Navbar locale="zh" />
      <main>
        <Hero locale="zh" />
        <TreasurySection locale="zh" />
        <TokenomicsSection locale="zh" />
        <HowItWorksSection locale="zh" />
        <TransparencySection locale="zh" />
        <GovernanceSection locale="zh" />
        <FeatureStrip locale="zh" />
      </main>
      <Footer locale="zh" />
    </>
  );
}
