import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CHALLENGES_ENABLED } from "@/lib/flags";
import { AppShell, ChallengesSlot, NAV_ITEMS } from "./app-shell";

/**
 * The v2 shell (section 4.0), asserted on rendered markup.
 *
 * The Challenges rule is the one most likely to be undone by a well-meaning
 * edit ("make it a disabled button"), so it is pinned here: while the flag is
 * off the slot is not a control of any kind.
 */

const shell = (active: Parameters<typeof AppShell>[0]["active"]) =>
  renderToStaticMarkup(
    <AppShell active={active} onNavigate={() => {}} displayName="Ajinkya Jadhav">
      <p>content</p>
    </AppShell>,
  );

describe("Challenges slot", () => {
  it("ships disabled", () => {
    expect(CHALLENGES_ENABLED).toBe(false);
  });

  it("is a span, not a button, and cannot take focus", () => {
    const html = renderToStaticMarkup(<ChallengesSlot />);
    expect(html).not.toContain("<button");
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/tabindex/i);
    expect(html).not.toMatch(/href=/);
  });

  it("tells a screen reader it is coming soon, and hides the decorative badge", () => {
    const html = renderToStaticMarkup(<ChallengesSlot />);
    expect(html).toContain('<span class="sr-only">, coming soon</span>');
    expect(html).toMatch(/class="iki-soon-badge" aria-hidden="true">Soon</);
  });

  it("becomes a real nav button only when enabled and wired", () => {
    const html = renderToStaticMarkup(<ChallengesSlot enabled onOpen={() => {}} />);
    expect(html).toContain("<button");
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("iki-soon-badge");
  });
});

describe("bottom bar", () => {
  it("has Home, Trends, the check-in button, Future and Challenges, and no More", () => {
    const html = shell("home");
    const order = ["Home", "Trends", 'aria-label="Daily check-in"', "Future", "Challenges"].map(
      (s) => html.indexOf(s, html.indexOf('aria-label="Sections"')),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain(">More<");
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  it("marks nothing current on Report, which is reached from Home", () => {
    const nav = shell("report").split('aria-label="Sections"')[1];
    expect(nav).not.toContain('aria-current="page"');
  });

  it("keeps report, rewards and profile deep-linkable", () => {
    const keys = NAV_ITEMS.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["report", "partners", "profile"]));
  });
});

describe("header", () => {
  it("shows the labelled Profile chip on top-level screens", () => {
    const html = shell("home");
    expect(html).toContain('aria-label="Profile"');
    expect(html).toContain("AJ");
    expect(html).toContain('aria-label="Ikigaro home"');
  });

  it("offers the way back on Rewards instead of the wordmark", () => {
    const html = shell("partners");
    expect(html).toContain(">Home</button>");
    expect(html).not.toContain('aria-label="Ikigaro home"');
  });
});
