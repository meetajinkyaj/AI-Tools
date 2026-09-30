import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RANKS } from "@/lib/iki-rank";
import { RankSheet } from "./rank-sheet";

const render = (score: number) =>
  renderToStaticMarkup(<RankSheet score={score} onShare={() => {}} onClose={() => {}} />);

describe("rank sheet", () => {
  it("is a modal dialog named for what it shows", () => {
    const html = render(720);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Your rank"');
  });

  it("marks the member's rung and says how far the next one is", () => {
    const html = render(720);
    expect(html).toContain("You · 720");
    expect(html).toContain("1,280 iki away");
    expect(html).toContain('aria-current="step"');
  });

  it("uses the repo's rank names, not the mock's placeholders", () => {
    const html = render(720);
    expect(html).toContain("Iki Pro");
    expect(html).toContain("Iki Sensei");
    expect(html).not.toContain("Iki Adept");
    expect(html).not.toContain("Iki Master");
  });

  it("never reveals the secret rank before it is reached", () => {
    const secret = RANKS.find((r) => r.secret)!;
    const html = render(secret.threshold - 1);
    expect(html).not.toContain(secret.name);
    expect(html).not.toContain(secret.threshold.toLocaleString("en-US"));
  });

  it("owns Share your rank", () => {
    expect(render(0)).toContain("Share your rank");
  });
});
