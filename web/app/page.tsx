import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { TreasurySection } from "@/components/TreasurySection";
import { VaultSection } from "@/components/VaultSection";
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
        <VaultSection />
        <TransparencySection />
        <GovernanceSection />
        <FAQ />
        <FeatureStrip />
      </main>
      <Footer />
    </>
  );
}
