/**
 * The project's Privy app ID. This is public — it ships in the client bundle
 * and identifies the app to Privy — so it is safe to commit.
 *
 * Why hardcode it: `NEXT_PUBLIC_*` values are inlined by Next.js at BUILD time.
 * On Cloudflare the Privy app ID was only set as a runtime variable, so a fresh
 * CI build inlined `process.env.NEXT_PUBLIC_PRIVY_APP_ID` as empty and the Privy
 * provider crashed the whole app on load ("invalid Privy app ID"). Reading a
 * plain constant (still overridable at build via `NEXT_PUBLIC_PRIVY_APP_ID`)
 * removes that build-vs-runtime pitfall — the same fix used for the Supabase URL
 * in `supabase-admin.ts`.
 */
export const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmr7snzr8003e0ejvn5y0sppr";
