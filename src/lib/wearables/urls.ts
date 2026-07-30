import type { ProviderId } from "./types";

/**
 * The OAuth redirect URI.
 *
 * MUST MATCH THE VENDOR REGISTRATION EXACTLY — scheme, host, path, no trailing
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
  return `${appOrigin()}/?wearable=${status}&provider=${encodeURIComponent(provider)}`;
}
