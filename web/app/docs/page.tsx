import type { Metadata } from "next";
import { DocsPage } from "@/components/DocsPage";

export const metadata: Metadata = {
  title: "Documentation — Reserved (RSVD)",
  description: "How Reserved actually works, contract by contract.",
  alternates: { canonical: "/docs", languages: { en: "/docs", "zh-Hans": "/zh/docs" } },
};

export default function Docs() {
  return <DocsPage locale="en" />;
}
