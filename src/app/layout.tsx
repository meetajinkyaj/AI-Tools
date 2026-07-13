import type { Metadata } from "next";
import { Cormorant_Garamond, Hanken_Grotesk, Marcellus } from "next/font/google";
import "./globals.css";

// Three brand voices (Ikigaro Brand Guidelines §9):
//  - Cormorant Garamond → display & wordmark (editorial serif)
//  - Marcellus          → labels, eyebrows, the pillars line (Roman caps)
//  - Hanken Grotesk     → body, UI, captions (neutral grotesque)
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

const marcellus = Marcellus({
  variable: "--font-marcellus",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ikigaro",
  description:
    "The operating system for performance, recovery & longevity.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${marcellus.variable} ${hanken.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
