import type { Metadata } from "next";
import { DocsPage } from "@/components/DocsPage";

export const metadata: Metadata = {
  title: "Documentation — Reserve Holdings (RHOLD)",
  description: "How Reserve Holdings actually works — the mechanism behind it, plainly explained.",
  alternates: { canonical: "/docs", languages: { en: "/docs", "zh-Hans": "/zh/docs" } },
};

export default function Docs() {
  return <DocsPage locale="en" />;
}
