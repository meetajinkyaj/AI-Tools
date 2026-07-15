"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Card, Eyebrow } from "./ui";

/**
 * Partners tab — the redemption ecosystem. Mirrors the marketing site's
 * #partners section. No partners are onboarded yet, so this shows the user's
 * earned iki points, the coming categories, and a partner-enquiry CTA; it's
 * structured to render a real catalog once redemption_items exist.
 */

const CATEGORIES = [
  "Recovery",
  "Diagnostics",
  "Nutrition",
  "Sleep",
  "Movement",
];

export function PartnersView({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  const [pointsBalance, setPointsBalance] = useState<number | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/checkin", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { pointsBalance: number };
      setPointsBalance(data.pointsBalance);
    } catch (err) {
      console.error("Failed to load points balance:", err);
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Eyebrow>Partners · Coming soon</Eyebrow>
        <h1 className="font-display text-3xl font-medium leading-tight tracking-tight text-foreground sm:text-4xl">
          An ecosystem worth{" "}
          <span className="italic text-accent">earning into</span>.
        </h1>
        <p className="max-w-xl font-body text-sm leading-relaxed text-muted">
          We&rsquo;re bringing a considered set of partners into the Ikigaro
          ecosystem — the products and practices we&rsquo;d use ourselves. The
          iki points you earn will be redeemable for them. Partners appear here
          as the doors open.
        </p>
      </div>

      <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <Eyebrow>Your iki points</Eyebrow>
          <p className="font-display text-3xl font-medium text-foreground">
            {pointsBalance ?? 0}
          </p>
        </div>
        <p className="max-w-xs font-body text-sm text-muted">
          Redeemable once partners open. Keep your streak going to earn more.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {CATEGORIES.map((category) => (
          <div
            key={category}
            className="flex h-24 items-center justify-center rounded-card border border-dashed border-border-strong/60"
          >
            <span className="font-label text-xs uppercase tracking-[0.2em] text-muted">
              {category}
            </span>
          </div>
        ))}
      </div>

      <Card className="p-6">
        <p className="font-body text-sm text-muted">
          Building something for high performers?{" "}
          <a
            href="mailto:hello@ikigaro.com?subject=Partner%20enquiry"
            className="text-accent underline"
          >
            Write to us.
          </a>
        </p>
      </Card>
    </div>
  );
}
