import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { HowItWorksSection } from "@/components/HowItWorksSection";
import { TokenomicsSection } from "@/components/TokenomicsSection";
import { TreasurySection } from "@/components/TreasurySection";
import { TransparencySection } from "@/components/TransparencySection";
import { GovernanceSection } from "@/components/GovernanceSection";
import { FeatureStrip } from "@/components/FeatureStrip";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <HowItWorksSection />
        <TokenomicsSection />
        <TreasurySection />
        <TransparencySection />
        <GovernanceSection />
        <FeatureStrip />
      </main>
      <Footer />
    </>
  );
}
