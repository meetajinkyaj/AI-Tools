import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Unsubscribing from announcements. Public, no login required.
 *
 * WHY GET DOES NOT UNSUBSCRIBE. Mail providers and corporate security gateways
 * prefetch links in messages to scan them. If the GET performed the opt-out,
 * a scanner would unsubscribe people who never clicked anything, and neither
 * they nor we would ever know why the announcements stopped. So GET renders a
 * page with a button, and only the POST it submits changes anything.
 *
 * Requiring a login here would be worse than useless: someone who wants the
 * mail to stop should not have to remember a password to make it stop, and an
 * unsubscribe link that leads to a sign-in wall is one that gets reported as
 * spam instead.
 *
 * TRANSACTIONAL MAIL IS UNAFFECTED. This sets `email_opt_out`, which suppresses
 * announcements only. The access-granted email answers an action the user took
 * and still sends.
 */

function page(title: string, message: string, form?: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title} · Ikigaro</title>
  </head>
  <body style="margin:0;padding:48px 24px;background:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1b19;">
    <div style="max-width:420px;margin:0 auto;">
      <p style="margin:0 0 24px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a8378;">Ikigaro</p>
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:500;line-height:1.3;">${title}</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${message}</p>
      ${form ?? ""}
    </div>
  </body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) return page("Link not recognised", "This unsubscribe link is incomplete.");

  // Deliberately does NOT check the token here. Telling an anonymous caller
  // whether a token is real turns this into a way to test guesses, and the
  // POST validates it anyway.
  return page(
    "Unsubscribe from announcements?",
    "You&rsquo;ll stop receiving Ikigaro announcements. Emails that answer something you did, like being let into the beta, will still reach you.",
    `<form method="POST" action="/api/email/unsubscribe?t=${encodeURIComponent(token)}">
        <button type="submit" style="display:inline-block;padding:12px 24px;background:#1c1b19;color:#faf8f5;border:0;border-radius:999px;font-size:14px;cursor:pointer;">Yes, unsubscribe me</button>
      </form>`,
  );
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  if (!token) return page("Link not recognised", "This unsubscribe link is incomplete.");

  // A malformed token is not a uuid and would make Postgres raise rather than
  // return no rows, so it is rejected before the query.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return page("Link not recognised", "This unsubscribe link is not valid.");
  }

  const supabase = createSupabaseAdmin();
  const { data } = await supabase
    .from("users")
    .update({ email_opt_out: true })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();

  if (!data) {
    // Same wording either way, a stale link and a wrong one are the same
    // thing from here, and distinguishing them helps nobody but a guesser.
    return page(
      "Link not recognised",
      "This unsubscribe link is not valid. It may have already been used, or the account may be gone.",
    );
  }

  return page(
    "Done, you're unsubscribed",
    "You won&rsquo;t receive Ikigaro announcements any more. If this was a mistake, just reply to any email from us and we&rsquo;ll put you back.",
  );
}
