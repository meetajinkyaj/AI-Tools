import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Hanken_Grotesk, Marcellus } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegistrar } from "./service-worker-registrar";

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
  applicationName: "Ikigaro",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Ikigaro" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#b5562d",
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
        {children}
      </body>
    </html>
  );
}
