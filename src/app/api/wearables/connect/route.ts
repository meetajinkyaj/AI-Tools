import { NextResponse } from "next/server";

import { getPrivyUserId } from "@/lib/api-auth";
import { resolveApprovedUserId } from "@/lib/app-user";
import { wearableKeyProblem } from "@/lib/wearables/crypto";
import { signState } from "@/lib/wearables/oauth-state";
import { PROVIDERS, isProviderId, providerConfigured } from "@/lib/wearables/providers";
import { callbackUrl } from "@/lib/wearables/urls";

/**
 * GET /api/wearables/connect?provider=oura
 *
 * Returns the vendor's consent URL for the browser to open. It returns the URL
 * rather than 302-ing because the caller is a fetch() from an authenticated
 * screen, a redirect would be followed by fetch and land the consent page
 * inside an XHR, which the user never sees.
 */
export async function GET(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = await resolveApprovedUserId(privyUserId);
  if (!userId) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const providerId = new URL(request.url).searchParams.get("provider");
  if (!providerId || !isProviderId(providerId)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // CHECKED BEFORE THE VENDOR, NOT AFTER. Storing a grant needs a usable
  // encryption key, and finding out it is unusable in the callback means the
  // user has already read a consent screen and tapped Approve for nothing. The
  // reason is logged for us; the user gets a plain sentence, since a base64
  // complaint is not theirs to act on.
  const keyProblem = wearableKeyProblem();
  if (keyProblem) {
    console.error(`wearable connect refused: ${keyProblem}`);
    return NextResponse.json(
      { error: "Device connections aren't available right now." },
      { status: 503 },
    );
  }

  const provider = PROVIDERS[providerId];
  if (!providerConfigured(provider)) {
    // Better a clear 503 than sending the user to a vendor page that will
    // reject an empty client_id with the vendor's own branding on the error.
    return NextResponse.json(
      { error: `${provider.name} isn't configured yet.` },
      { status: 503 },
    );
  }

  const clientId = process.env[provider.clientIdEnv]!;
  const state = await signState(userId, providerId);

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUrl(providerId));
  // Omitted entirely when a vendor has no scopes rather than sent empty. COROS
  // define none at all, and `scope=` is a parameter with no meaning to them:
  // at best ignored, at worst a reason to reject an authorize request.
  if (provider.scopes.length > 0) {
    url.searchParams.set("scope", provider.scopes.join(" "));
  }
  url.searchParams.set("state", state);
  // Vendor-specific extras, set last so a provider cannot quietly override
  // `state` or `redirect_uri` and weaken the flow.
  for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) {
    if (["state", "redirect_uri", "client_id", "response_type"].includes(k)) continue;
    url.searchParams.set(k, v);
  }

  return NextResponse.json({ url: url.toString() });
}
