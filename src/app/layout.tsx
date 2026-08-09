import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Hanken_Grotesk, Marcellus } from "next/font/google";
import "./globals.css";
import { EnvBanner } from "./env-banner";
import { ServiceWorkerRegistrar } from "./service-worker-registrar";

// Three brand voices (Ikigaro Brand Guidelines §9, design handoff §1.3):
//  - Cormorant Garamond → display & wordmark (editorial serif)
//  - Marcellus          → labels, eyebrows, the pillars line (Roman caps)
//  - Hanken Grotesk     → body, UI, captions (neutral grotesque)
//
// Each exposes a CSS variable that globals.css maps onto a --font-* token.
// Components reference the token, never the variable, so changing a face is a
// one-line edit here rather than a search across every screen.
//
// NO JAPANESE FACE IS LOADED, and that is deliberate. The handoff asks for
// Noto Sans JP for the four rank kanji. This repo already solves that better:
// `src/lib/rank-kanji.ts` carries them as outline paths, so they render
// identically in the app, in the share card and in a PDF, with no webfont at
// all. Downloading a CJK family for four glyphs would be a large payload to
// reach a worse place. `--font-jp` exists in the token layer with a system
// stack, for text that is genuinely Japanese rather than for the seals.
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
  // 700 is in the handoff's scale (flag badges, points amounts, the copy chip)
  // and was not loaded, so those would have rendered at 600 and looked like a
  // font-weight that did not take.
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ikigaro",
  description:
    "The operating system for performance, recovery & longevity.",
  applicationName: "Ikigaro",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Ikigaro" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#b5562d",
  colorScheme: "light",
  /*
   * REQUIRED FOR env(safe-area-inset-*) TO BE ANYTHING BUT ZERO.
   *
   * Without `cover`, the browser fits the page inside the safe area itself,
   * every inset reports 0, and each safe-area calc in globals.css silently
   * becomes a no-op that looks like it works. With it the page paints edge to
   * edge and the insets carry real values, which is what the floating nav and
   * the shell padding use to clear the notch and the home indicator.
   */
  viewportFit: "cover",
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
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistrar />
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
