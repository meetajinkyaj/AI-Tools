import type { ProviderId } from "./types";

/**
 * The OAuth redirect URI.
 *
 * MUST MATCH THE VENDOR REGISTRATION EXACTLY, scheme, host, path, no trailing
 * slash. Every vendor here rejects a mismatch outright, and the error they
 * return says only "invalid redirect_uri", which is the least helpful possible
 * description of a typo. Building it in one place means the value registered in
 * six dashboards is the value six code paths send.
 *
 * `APP_ORIGIN` overrides for staging, where the host differs and the vendor
 * registration points somewhere else.
 */
function appOrigin(): string {
  return process.env.APP_ORIGIN || "https://app.ikigaro.com";
}

export function callbackUrl(provider: ProviderId): string {
  return `${appOrigin()}/api/wearables/callback/${provider}`;
}

/** Where the user lands after consent, with a result to show. */
export function connectResultUrl(status: "connected" | "failed", provider: string): string {
  /*
   * Back to PROFILE, which is where connected devices live.
   *
   * This used to land on Home, and the row that reports the outcome only
   * mounts on Profile: a member who had just approved access at Oura was
   * returned to a screen that said nothing about it, and the result banner
   * waited, unseen, until they happened to open Settings. It was the best that
   * could be done while the section was React state and the URL could not name
   * one; the shell's `?tab=` makes the right target expressible.
   */
  return `${appOrigin()}/?tab=profile&wearable=${status}&provider=${encodeURIComponent(provider)}`;
}
