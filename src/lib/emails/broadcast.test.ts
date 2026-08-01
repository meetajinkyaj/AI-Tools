import { describe, expect, it } from "vitest";

import {
  bodyToParagraphs,
  broadcastEmail,
  resolveAudience,
  validateBroadcast,
  type AudienceCandidate,
} from "./broadcast";

/**
 * A broadcast is the one thing in this product that cannot be undone. These
 * tests cover the two ways it goes badly wrong: reaching someone it should not
 * have, and carrying markup nobody wrote.
 */

const person = (over: Partial<AudienceCandidate> & { id: string }): AudienceCandidate => ({
  email: `${over.id}@example.com`,
  access_status: "approved",
  email_opt_out: false,
  deleted_at: null,
  ...over,
});

describe("who receives it", () => {
  it("never mails someone who opted out", () => {
    // The entire point of the opt-out. Getting this wrong invites spam
    // complaints, which damage the domain and take the approval email with it.
    const out = resolveAudience("approved", [
      person({ id: "a" }),
      person({ id: "b", email_opt_out: true }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });

  it("never mails a deleted account", () => {
    const out = resolveAudience("everyone", [
      person({ id: "a" }),
      person({ id: "b", deleted_at: "2026-07-01T00:00:00Z" }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });

  it("skips accounts with no address", () => {
    const out = resolveAudience("approved", [person({ id: "a", email: null }), person({ id: "b" })]);
    expect(out.map((p) => p.id)).toEqual(["b"]);
  });

  it("sends one copy per inbox, not per account", () => {
    // Two accounts on one address is one human, who should not receive the
    // same announcement twice.
    const out = resolveAudience("approved", [
      person({ id: "a", email: "same@example.com" }),
      person({ id: "b", email: "SAME@example.com" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("targets the chosen group only", () => {
    const roster = [
      person({ id: "in", access_status: "approved" }),
      person({ id: "waiting", access_status: "waitlisted" }),
    ];
    expect(resolveAudience("approved", roster).map((p) => p.id)).toEqual(["in"]);
    expect(resolveAudience("waitlisted", roster).map((p) => p.id)).toEqual(["waiting"]);
    expect(resolveAudience("everyone", roster).map((p) => p.id)).toEqual(["in", "waiting"]);
  });

  it("excludes statuses that are neither, even under 'everyone'", () => {
    // "Everyone" means everyone we have a relationship with, not every row.
    const out = resolveAudience("everyone", [person({ id: "odd", access_status: "banned" })]);
    expect(out).toEqual([]);
  });
});

describe("turning typed text into an email", () => {
  const msg = (body: string) =>
    broadcastEmail({ to: "x@example.com", subject: "News", body, unsubscribeToken: "tok-123" });

  it("splits blank-line-separated blocks into paragraphs", () => {
    expect(bodyToParagraphs("One.\n\nTwo.\n\n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("escapes anything typed into the composer", () => {
    // The composer takes plain text. If markup survived, pasted content would
    // be an injection vector into every user's inbox.
    const m = msg("<script>alert(1)</script> hello there");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it("does not let a typed link become a real anchor", () => {
    const m = msg('Check <a href="https://evil.example">this</a> out now');
    expect(m.html).not.toContain('<a href="https://evil.example"');
  });

  it("always carries both parts", () => {
    const m = msg("A reasonable announcement about something.");
    expect(m.text.length).toBeGreaterThan(50);
    expect(m.html).toContain("<!doctype html>");
  });

  it("carries a working unsubscribe link in both parts", () => {
    // Non-negotiable: an announcement without one leaves the spam button as
    // the recipient's only tool.
    const m = msg("Something worth announcing here.");
    expect(m.text).toContain("/api/email/unsubscribe?t=tok-123");
    expect(m.html).toContain("/api/email/unsubscribe?t=tok-123");
  });

  it("escapes the token into the URL", () => {
    const m = broadcastEmail({
      to: "x@example.com",
      subject: "s",
      body: "body text here",
      unsubscribeToken: "a b&c",
    });
    expect(m.html).toContain("t=a%20b%26c");
  });

  it("signs off from a person, above the company", () => {
    expect(msg("Body text goes here.").text).toContain("— Ajinkya\nIkigaro");
  });
});

describe("refusing to send nonsense", () => {
  it("requires a subject", () => {
    expect(validateBroadcast("", "a long enough body here").ok).toBe(false);
    expect(validateBroadcast("Hi", "a long enough body here").ok).toBe(false);
  });

  it("requires a body worth reading", () => {
    expect(validateBroadcast("A real subject", "short").ok).toBe(false);
  });

  it("rejects an overlong subject rather than letting it be truncated silently", () => {
    expect(validateBroadcast("x".repeat(200), "a long enough body here").ok).toBe(false);
  });

  it("accepts a reasonable message", () => {
    expect(validateBroadcast("Wearables are live", "Oura is now connectable in Settings.").ok).toBe(
      true,
    );
  });

  it("ignores surrounding whitespace when judging length", () => {
    expect(validateBroadcast("   ", "   ").ok).toBe(false);
  });
});
