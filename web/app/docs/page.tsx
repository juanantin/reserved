import type { Metadata } from "next";
import { DocsPage } from "@/components/DocsPage";

export const metadata: Metadata = {
  title: "Documentation — Reserve Holdings (RHLD)",
  description: "How Reserve Holdings actually works, contract by contract.",
  alternates: { canonical: "/docs", languages: { en: "/docs", "zh-Hans": "/zh/docs" } },
};

export default function Docs() {
  return <DocsPage locale="en" />;
}
