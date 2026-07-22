import type { MetadataRoute } from "next";

/**
 * Web app manifest (Next metadata route → served at /manifest.webmanifest).
 * Makes Ikigaro installable ("add to home screen") with a branded icon and
 * standalone, full-screen chrome. Colors are the golden-hour brand tokens.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ikigaro",
    short_name: "Ikigaro",
    description: "The operating system for performance, recovery & longevity.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1e9dc", // onsen-linen
    theme_color: "#b5562d", // golden-hour
    orientation: "portrait",
    categories: ["health", "lifestyle", "medical"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
