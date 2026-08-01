import { describe, expect, it } from "vitest";

import { accessGrantedEmail } from "./access-granted";
import { broadcastEmail } from "./broadcast";
import { activeSocials, socialsHtml, socialsText } from "./socials";

/**
 * These are live links going into real inboxes. An email cannot be corrected
 * after it is sent, so a typo here is permanent, hence asserting the actual
 * URLs rather than merely that "some links exist".
 */

describe("the accounts we point people at", () => {
  it("carries all three, spelled exactly", () => {
    expect(activeSocials()).toEqual([
      { label: "Instagram", url: "https://www.instagram.com/ikigaro/" },
      { label: "X", url: "https://x.com/ikigaro_" },
      { label: "LinkedIn", url: "https://www.linkedin.com/company/ikigaro/" },
    ]);
  });

  it("is https and absolute throughout", () => {
    // A relative or http link in an email is broken or insecure, there is no
    // page context to resolve it against.
    for (const s of activeSocials()) {
      expect(s.url, s.label).toMatch(/^https:\/\//);
    }
  });

  it("renders as text links, never images", () => {
    // Mail clients block remote images by default, so icons would arrive as
    // broken-image boxes. Remote images are also the standard open-tracking
    // beacon, and none of our mail tracks anyone.
    expect(socialsHtml()).not.toMatch(/<img/i);
    expect(socialsHtml()).toContain("<a href=");
  });

  it("puts the URL in the plain-text part, not just the label", () => {
    // Someone reading the text version has nothing to click, so the address
    // itself has to be there.
    const text = socialsText().join("\n");
    for (const s of activeSocials()) {
      expect(text, s.label).toContain(s.url);
    }
  });
});

describe("both emails carry them", () => {
  const access = accessGrantedEmail({ to: "x@example.com", fullName: "Sam" });
  const announcement = broadcastEmail({
    to: "x@example.com",
    subject: "News",
    body: "Something worth announcing.",
    unsubscribeToken: "11111111-1111-1111-1111-111111111111",
  });

  it("appears in the access-granted email", () => {
    expect(access.html).toContain("https://x.com/ikigaro_");
    expect(access.text).toContain("https://www.instagram.com/ikigaro/");
  });

  it("appears in announcements", () => {
    expect(announcement.html).toContain("https://www.linkedin.com/company/ikigaro/");
    expect(announcement.text).toContain("https://x.com/ikigaro_");
  });

  it("does not push the unsubscribe link out of the announcement footer", () => {
    // The social row sits next to it. Losing the unsubscribe link to a layout
    // change is the one regression that matters here.
    expect(announcement.html).toContain("/api/email/unsubscribe?t=");
    expect(announcement.text).toContain("/api/email/unsubscribe?t=");
  });

  it("keeps the access-granted email free of an unsubscribe link", () => {
    // It is transactional, it answers something the user did, and offering to
    // unsubscribe from it would be offering something we will not honour.
    expect(access.html).not.toContain("/api/email/unsubscribe");
  });
});
