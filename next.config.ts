import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@privy-io/react-auth"],
};

export default nextConfig;

initOpenNextCloudflareForDev();
