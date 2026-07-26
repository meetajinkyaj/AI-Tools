import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/** The public app host; /admin is not served here. */
const APP_HOST = "app.ikigaro.com";
/** The Cloudflare Access-gated admin host. */
const ADMIN_URL = "https://admin.ikigaro.com/admin";

const nextConfig: NextConfig = {
  /**
   * Send app.ikigaro.com/admin to the gated admin subdomain.
   *
   * This lives in the config rather than the page because `redirect()` called
   * while rendering does NOT produce an HTTP redirect here: the admin page
   * streams, and in a streaming context Next emits a client-side redirect
   * instruction instead — the response is a 200 whose RSC payload carries
   * `NEXT_REDIRECT;replace;…`. Real browsers follow it (and no admin UI is
   * rendered), but anything that doesn't run React just sees a 200, and the
   * user reaching the gated host depends on client JS. A config redirect runs
   * before rendering and returns a real 307.
   *
   * Host-scoped, so staging and localhost keep serving /admin directly — that
   * is what makes a fresh environment bootstrappable (docs/STAGING.md §2).
   */
  async redirects() {
    return [
      {
        source: "/admin",
        has: [{ type: "host", value: APP_HOST }],
        destination: ADMIN_URL,
        permanent: false, // 307 — the host split is operational, not permanent
      },
    ];
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
