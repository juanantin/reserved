import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { TreasurySection } from "@/components/TreasurySection";
import { PortfolioSection } from "@/components/PortfolioSection";
import { TransparencySection } from "@/components/TransparencySection";
import { GovernanceSection } from "@/components/GovernanceSection";
import { FAQ } from "@/components/FAQ";
import { FeatureStrip } from "@/components/FeatureStrip";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <TreasurySection />
        <PortfolioSection />
        <TransparencySection />
        <GovernanceSection />
        <FAQ />
        <FeatureStrip />
      </main>
      <Footer />
    </>
  );
}
