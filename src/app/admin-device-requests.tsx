"use client";

import { useCallback, useEffect, useState } from "react";

import type { DeviceTally } from "@/lib/device-requests";
import { Card, Eyebrow } from "./ui";

/**
 * Admin → Requests. Which device to integrate next, as a number.
 *
 * THE TALLY LEADS. The decision this screen exists to support is "which vendor
 * do I chase next", and that decision is a ranked count. The individual entries
 * matter too, but they are evidence, not the answer, so they sit underneath.
 *
 * The raw text is always shown next to the bucket it folded into, because a
 * normalisation table is only ever approximately right and this is the only
 * place a wrong fold becomes visible. If "the ring my wife has" is sitting in
 * its own bucket, you want to see that.
 */

interface Entry {
  deviceKey: string;
  rawText: string;
  notify: boolean;
  notifiedAt: string | null;
  createdAt: string;
  email: string | null;
  name: string | null;
}

interface Payload {
  tally: DeviceTally[];
  entries: Entry[];
  requesterCount: number;
}

function when(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function DeviceRequestsPanel({ getToken }: { getToken: () => Promise<string | null> }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/admin/device-requests", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError("Couldn't load requests.");
        return;
      }
      setData((await res.json()) as Payload);
    } catch {
      setError("Couldn't load requests.");
    }
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (error) return <Card className="p-5 text-body-sm text-muted">{error}</Card>;
  if (!data) return null;

  if (data.tally.length === 0) {
    return (
      <Card className="flex flex-col gap-2 p-5">
        <Eyebrow>Device requests</Eyebrow>
        <p className="text-body-sm text-muted">
          Nobody has suggested a device yet. The box sits under Connected devices in Settings.
        </p>
      </Card>
    );
  }

  const totalNotify = data.tally.reduce((n, d) => n + d.notifyCount, 0);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>What to add next</Eyebrow>
          <span className="text-micro text-muted">
            {data.requesterCount} {data.requesterCount === 1 ? "person" : "people"} asked ·{" "}
            {totalNotify} want an email on launch
          </span>
        </div>

        <ul className="flex flex-col">
          {data.tally.map((d) => {
            const open = expanded === d.key;
            const forThis = data.entries.filter((e) => e.deviceKey === d.key);
            return (
              <li key={d.key} className="border-t border-line py-3 first:border-t-0 first:pt-0">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : d.key)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm font-semibold text-ink">
                        {d.label}
                      </span>
                      {d.supported && (
                        <Tag tone="ok">already supported</Tag>
                      )}
                      {d.blocked && <Tag tone="warn">blocked</Tag>}
                      {d.unrecognised && <Tag tone="muted">unrecognised</Tag>}
                    </span>
                    {/* Why we cannot do it, kept next to the demand, so a big
                        number against a blocked device reads as "go talk to
                        the vendor", not as a backlog item. */}
                    {d.reason && (
                      <span className="text-micro text-muted">{d.reason}</span>
                    )}
                    {d.notifyCount > 0 && (
                      <span className="text-micro text-muted">
                        {d.notifyCount} want an email when it lands
                      </span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-baseline gap-1">
                    <span className="font-display text-lg text-ink">{d.count}</span>
                    <span className="text-micro text-muted">
                      {d.count === 1 ? "person" : "people"}
                    </span>
                  </span>
                </button>

                {open && (
                  <ul className="mt-2 flex flex-col gap-1 border-l border-line pl-3">
                    {forThis.map((e) => (
                      <li
                        key={`${e.email}-${e.createdAt}`}
                        className="flex flex-wrap items-baseline gap-x-2 text-micro text-muted"
                      >
                        <span className="text-ink">{e.name || e.email || "unknown"}</span>
                        {/* Verbatim, so a bad fold is visible. */}
                        <span>typed &ldquo;{e.rawText}&rdquo;</span>
                        <span>· {when(e.createdAt)}</span>
                        {e.notify && <span>· wants an email</span>}
                        {e.notifiedAt && <span>· already emailed</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="text-micro text-muted">
        Counts are distinct people, one person can suggest several devices, but
        cannot vote twice for the same one. Tap a row to see who asked and what
        they typed.
      </p>
    </div>
  );
}

function Tag({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-primary/40 text-primary"
      : tone === "warn"
        ? "border-line text-ink"
        : "border-line text-muted";
  return (
    <span
      className={`rounded-pill border px-2 py-0.5 font-label text-[0.55rem] uppercase tracking-[0.18em] ${cls}`}
    >
      {children}
    </span>
  );
}
