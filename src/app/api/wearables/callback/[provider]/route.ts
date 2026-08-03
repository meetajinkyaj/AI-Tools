import { NextResponse } from "next/server";

import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { verifyState } from "@/lib/wearables/oauth-state";
import { isProviderId, PROVIDERS } from "@/lib/wearables/providers";
import { persistTokens, requestTokens, syncConnection } from "@/lib/wearables/sync";
import { callbackUrl, connectResultUrl } from "@/lib/wearables/urls";
import type { ConnectionRow } from "@/lib/wearables/sync";

/**
 * GET /api/wearables/callback/[provider]
 *
 * Where the vendor sends the browser after consent.
 *
 * THIS ROUTE IS UNAUTHENTICATED BY NECESSITY, it is a top-level navigation
 * from a third-party site, so there is no bearer token to check. The signed
 * `state` is therefore the *only* thing establishing whose account this
 * connection attaches to, and it is verified before anything else happens. A
 * bad or expired signature is treated as hostile and gets nothing but a
 * redirect: no error detail, no hint about whether the user id existed.
 *
 * It always redirects rather than returning JSON. The person at the other end
 * is a human in a browser who just tapped "Allow", and a page of JSON is a
 * dead end for them.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerParam } = await params;
  const url = new URL(request.url);

  if (!isProviderId(providerParam)) {
    return NextResponse.redirect(connectResultUrl("failed", "unknown"));
  }

  // The user declining at the vendor is a normal outcome, not an error.
  if (url.searchParams.get("error")) {
    return NextResponse.redirect(connectResultUrl("failed", providerParam));
  }

  const state = await verifyState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");

  // The state must also match the path we were called on, or a state minted
  // for one vendor could be replayed against another's callback.
  if (!state || !code || state.provider !== providerParam) {
    // The user still gets nothing but a redirect, but WE need to be able to
    // tell this apart from a failed token exchange: both end at the same URL,
    // and without this line the difference is invisible in the logs. The
    // reason is named, the state itself is never logged.
    //
    // `bad-or-expired-state` most often means the 15-minute TTL elapsed while
    // the consent screen sat open, which looks exactly like a broken
    // integration and is not one.
    console.error(
      `wearable callback rejected for ${providerParam} before exchange:`,
      !code ? "no-code" : !state ? "bad-or-expired-state" : "provider-mismatch",
    );
    return NextResponse.redirect(connectResultUrl("failed", providerParam));
  }

  try {
    const tokens = await requestTokens(providerParam, {
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(providerParam),
    });

    const supabase = createSupabaseAdmin();

    // Upsert on (user, provider): reconnecting replaces the old grant in place
    // instead of leaving a second row that also thinks it should be syncing.
    const { data: row, error } = await supabase
      .from("wearable_connections")
      .upsert(
        {
          user_id: state.userId,
          provider: providerParam,
          status: "active",
          failure_count: 0,
          last_error: null,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      )
      .select("*")
      .single();

    if (error || !row) throw new Error(error?.message ?? "connection upsert failed");

    await persistTokens(row.id as string, tokens);

    // Pull immediately so the user sees data on the screen they land on, rather
    // than an empty card and no idea whether it worked. Failure here is not
    // failure of the connection, the nightly sweep will retry.
    //
    // RE-READ THE ROW FIRST. `row` is what the upsert returned, which is the
    // state BEFORE the tokens were written. Syncing that copy finds no
    // credentials, raises ReauthRequired, and marks the connection `expired`, // so every successful connect would immediately present itself as broken.
    if (PROVIDERS[providerParam].fetchRange) {
      const { data: withTokens } = await supabase
        .from("wearable_connections")
        .select("*")
        .eq("id", row.id as string)
        .single();
      if (withTokens) {
        await syncConnection(withTokens as ConnectionRow).catch(() => undefined);
      }
    }

    return NextResponse.redirect(connectResultUrl("connected", providerParam));
  } catch (err) {
    console.error(`wearable callback failed for ${providerParam}:`, err);
    return NextResponse.redirect(connectResultUrl("failed", providerParam));
  }
}
