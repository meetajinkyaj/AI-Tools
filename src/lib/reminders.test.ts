import { describe, expect, it } from "vitest";

import { type PushSub, safeEqual, subscriptionsToNotify } from "./reminders";

const sub = (user_id: string, endpoint: string): PushSub => ({
  user_id,
  endpoint,
  p256dh: `p-${endpoint}`,
  auth: `a-${endpoint}`,
});

describe("subscriptionsToNotify", () => {
  it("notifies subscribers who have not checked in today", () => {
    const subs = [sub("u1", "e1"), sub("u2", "e2")];
    const out = subscriptionsToNotify(subs, new Set(["u2"]));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ endpoint: "e1", keys: { p256dh: "p-e1", auth: "a-e1" } });
  });

  it("notifies every device of a due user (multiple subscriptions)", () => {
    const subs = [sub("u1", "phone"), sub("u1", "laptop")];
    const out = subscriptionsToNotify(subs, new Set());
    expect(out.map((s) => s.endpoint).sort()).toEqual(["laptop", "phone"]);
  });

  it("notifies nobody when everyone has checked in", () => {
    const subs = [sub("u1", "e1"), sub("u2", "e2")];
    expect(subscriptionsToNotify(subs, new Set(["u1", "u2"]))).toEqual([]);
  });

  it("handles an empty subscription list", () => {
    expect(subscriptionsToNotify([], new Set())).toEqual([]);
  });
});

describe("safeEqual", () => {
  it("is true only for identical strings", () => {
    expect(safeEqual("secret-token", "secret-token")).toBe(true);
    expect(safeEqual("secret-token", "secret-toke")).toBe(false); // length differs
    expect(safeEqual("secret-token", "secret-tokes")).toBe(false); // same length, differs
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("a", "")).toBe(false);
  });
});
