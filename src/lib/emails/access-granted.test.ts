import { afterEach, describe, expect, it } from "vitest";

import { accessGrantedEmail, ACCESS_GRANTED_SUBJECT, shouldSendAccessEmail } from "./access-granted";

/**
 * The first email this product has ever sent. Two things have to hold: it goes
 * exactly once, and it does not embarrass us when it arrives.
 */

describe("sending exactly once", () => {
  const base = { previousStatus: "waitlisted", nextStatus: "approved", alreadySentAt: null };

  it("sends on the waitlisted -> approved transition", () => {
    expect(shouldSendAccessEmail(base)).toBe(true);
  });

  it("stays silent when re-approving someone already approved", () => {
    // A double-clicked Approve button, or an admin re-saving a row. Not a new
    // grant, so not a new email.
    expect(shouldSendAccessEmail({ ...base, previousStatus: "approved" })).toBe(false);
  });

  it("stays silent when the email already went for this grant", () => {
    expect(shouldSendAccessEmail({ ...base, alreadySentAt: "2026-07-30T10:00:00Z" })).toBe(false);
  });

  it("never sends when access is being revoked", () => {
    expect(shouldSendAccessEmail({ ...base, nextStatus: "waitlisted" })).toBe(false);
  });

  it("sends again after a genuine re-approval", () => {
    // Re-waitlisting clears the stamp, so being let back in notifies again.
    // Someone told they are out and then let back in has genuinely been let in
    // twice, and should hear about it both times.
    expect(
      shouldSendAccessEmail({
        previousStatus: "waitlisted",
        nextStatus: "approved",
        alreadySentAt: null,
      }),
    ).toBe(true);
  });

  it("treats a user with no prior status as a new grant", () => {
    expect(shouldSendAccessEmail({ ...base, previousStatus: null })).toBe(true);
  });
});

describe("the message itself", () => {
  const msg = () => accessGrantedEmail({ to: "someone@example.com", fullName: "Priya Sharma" });

  it("always carries a plain-text part", () => {
    // A mail with no text alternative is a strong spam signal, and this
    // product's first ever email landing in spam costs us the user it was
    // trying to reach.
    expect(msg().text.length).toBeGreaterThan(100);
    expect(msg().html.length).toBeGreaterThan(100);
  });

  it("greets by first name only", () => {
    expect(msg().text).toContain("Hi Priya,");
    expect(msg().text).not.toContain("Sharma");
  });

  it("degrades to a plain greeting with no name", () => {
    const m = accessGrantedEmail({ to: "x@example.com", fullName: null });
    expect(m.text).toContain("Hi,");
    expect(m.text).not.toContain("undefined");
    expect(m.text).not.toContain("null");
  });

  it("escapes a hostile display name", () => {
    const m = accessGrantedEmail({ to: "x@example.com", fullName: "<script>alert(1)</script>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it("ignores a name too long to be one", () => {
    const m = accessGrantedEmail({ to: "x@example.com", fullName: "x".repeat(200) });
    expect(m.text).toContain("Hi,");
  });

  it("links to the app in both parts", () => {
    const m = msg();
    expect(m.text).toContain("https://app.ikigaro.com");
    expect(m.html).toContain("https://app.ikigaro.com");
  });

  it("carries no invite link — the beta is closed on purpose", () => {
    // The moment someone is let in is the worst possible moment to ask them to
    // bring strangers to a waitlist. Mirrors INVITE_LINK_ON_SHARED_CARDS.
    const m = msg();
    for (const part of [m.text, m.html]) {
      expect(part).not.toMatch(/invite/i);
      expect(part).not.toMatch(/refer a friend/i);
      expect(part).not.toMatch(/\?ref=/);
    }
  });

  it("makes no health claim, and so carries no medical disclaimer", () => {
    // The disclaimer belongs on messages that give health information. Putting
    // it on one that does not is how it stops being read on the ones that do.
    const m = msg();
    expect(m.text).not.toMatch(/diagnos/i);
    expect(m.text).not.toMatch(/consult a doctor/i);
  });

  it("says why they are getting it", () => {
    expect(msg().text).toMatch(/because you joined/i);
  });

  it("has a subject that reads like a person wrote it", () => {
    expect(ACCESS_GRANTED_SUBJECT).toBe("You're in.");
    expect(msg().subject).toBe(ACCESS_GRANTED_SUBJECT);
  });

  it("has no tracking pixel or external asset", () => {
    // Nothing to load means nothing blocked, and no open-tracking beacon on a
    // transactional message.
    expect(msg().html).not.toMatch(/<img/i);
  });
});

describe("environment overrides", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("points at the staging host when APP_ORIGIN is set", () => {
    process.env.APP_ORIGIN = "https://staging.ikigaro.com";
    const m = accessGrantedEmail({ to: "x@example.com" });
    expect(m.text).toContain("https://staging.ikigaro.com");
    expect(m.text).not.toContain("https://app.ikigaro.com");
  });

  it("sets a reply-to only when one is configured", () => {
    delete process.env.EMAIL_REPLY_TO;
    expect(accessGrantedEmail({ to: "x@example.com" }).replyTo).toBeUndefined();

    process.env.EMAIL_REPLY_TO = "hello@ikigaro.com";
    expect(accessGrantedEmail({ to: "x@example.com" }).replyTo).toBe("hello@ikigaro.com");
  });
});
