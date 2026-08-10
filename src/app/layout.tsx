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
  /*
   * The browser chrome follows the ground now. Two entries rather than one:
   * a terracotta status bar over a dark app reads as a stripe of the wrong
   * colour at the top of every screen.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1e9dc" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1815" },
  ],
  // Both, so form controls, scrollbars and the keyboard follow suit rather
  // than staying light under a dark page.
  colorScheme: "light dark",
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
        {/*
          THE GROUND, DECIDED BEFORE ANYTHING PAINTS.
          
          This has to be an inline script and it has to run before the first
          paint. React cannot do it: by the time a component reads localStorage,
          the browser has already painted the light ground, and a member on dark
          gets a full-screen white flash on every cold load. That flash is the
          single most-reported bug in every hand-rolled dark mode.

          It duplicates the resolution rules in `src/lib/theme.ts` rather than
          importing them, because an import would mean a bundle, and a bundle is
          the thing that arrives too late. Three lines, and the module beside it
          is the version everything else uses and the tests cover.

          Wrapped in try/catch: localStorage throws outright in some private
          modes, and a theme preference is not worth taking the page down for.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=localStorage.getItem("ikigaro.theme");var d=p==="dark"||((!p||p==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
        <ServiceWorkerRegistrar />
        <EnvBanner />
        {children}
      </body>
    </html>
  );
}
