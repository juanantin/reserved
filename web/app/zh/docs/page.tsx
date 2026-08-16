import type { Metadata } from "next";
import { DocsPage } from "@/components/DocsPage";

const title = "文档 — Reserve Holdings (RHOLD)";
const description = "Reserve Holdings 实际运作方式的通俗讲解 —— 说清楚机制，而非营销话术。";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/zh/docs", languages: { en: "/docs", "zh-Hans": "/zh/docs" } },
  openGraph: { title, description, type: "website", images: ["/images/social-preview.svg"] },
  twitter: { card: "summary_large_image", title, description, images: ["/images/social-preview.svg"] },
};

export default function DocsZh() {
  return <DocsPage locale="zh" />;
}
