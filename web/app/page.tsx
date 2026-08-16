import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { FloorSection } from "@/components/FloorSection";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { TokenomicsSection } from "@/components/TokenomicsSection";
import { TreasurySection } from "@/components/TreasurySection";
import { TransparencySection } from "@/components/TransparencySection";
import { GovernanceSection } from "@/components/GovernanceSection";
import { VideoBanner } from "@/components/VideoBanner";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  alternates: { canonical: "/", languages: { en: "/", "zh-Hans": "/zh" } },
};

export default function Home() {
  return (
    <>
      <Navbar locale="en" />
      <main>
        <Hero locale="en" />
        <FloorSection locale="en" />
        <TreasurySection locale="en" />
        <TokenomicsSection locale="en" />
        <HowItWorksSection locale="en" />
        <TransparencySection locale="en" />
        <GovernanceSection locale="en" />
      </main>
      <VideoBanner />
      <Footer locale="en" />
    </>
  );
}
