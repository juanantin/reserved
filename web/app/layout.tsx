import type { Metadata } from "next";
import { Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const title = "Reserved (RSVD) — Real stocks. On-chain. Reserved.";
const description =
  "Reserved is an on-chain treasury that acquires and holds tokenized stocks for the long term, on BNB Chain.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://reserved.example"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: ["/images/social-preview.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/images/social-preview.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sora.variable}>
      <body className="antialiased overflow-x-hidden bg-rsvd-black text-rsvd-offwhite">{children}</body>
    </html>
  );
}
