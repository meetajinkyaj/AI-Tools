"use client";

import { useCallback, useEffect, useState } from "react";

import { display } from "./metric-format";
import { MetricIcon } from "./metric-icon";

/**
 * "What your Whoop says", one panel per connected device.
 *
 * WHY THIS IS NOT THE SAME AS "FROM YOUR DEVICES". That card shows the merged
 * answer: one number per metric per day, resolved across every device, which is
 * the right thing for somebody asking how they slept. This one shows the
 * opposite: exactly what ONE device reported, unmerged, including the days its
 * number lost to another device and the readings we store but do not chart.
 *
 * IT IS AN HONESTY SURFACE, AND ALSO A TEST SURFACE. Two questions it answers
 * that nothing else in the app could:
 *
 *   - "Whoop's app says 7h12m and yours says 6h50m." Different devices, and the
 *     panel names which one each night came from.
 *   - "I just connected this thing. Is it working?" A list of dated numbers is
 *     a better answer than a sparkline, because a sparkline with two points
 *     looks the same whether the integration is fine or half broken.
 *
 * COLLAPSED BY DEFAULT. It is detail, and detail that is open by default stops
 * being detail and starts being the page.
 */

interface Point {
  date: string;
  value: number;
  /** False when another device supplied that day's number in Trends. */
  used: boolean;
}

interface Metric {
  metric: string;
  label: string;
  unit: string;
  precision: number;
  /** What the number counts. Null when it needs no explaining. */
  note: string | null;
  points: Point[];
}

interface Workout {
  date: string;
  startedAt: string;
  minutes: number | null;
  activity: string | null;
  strain: number | null;
  calories: number | null;
  distanceM: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  autoDetected: boolean;
}

interface Device {
  id: string;
  name: string;
  status: string;
  lastSyncAt: string | null;
  metrics: Metric[];
  workouts: Workout[];
}

/** "Mon 4 Aug", short enough for a dense list. */
function shortDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * One metric, and every day of it this device sent.
 *
 * A TABLE, NOT A PARAGRAPH. These readings used to flow inline and wrap, so
 * "Mon 4 Aug 6h 48m Tue 5 Aug 7h 02m" ran together into prose and the numbers
 * did not line up with each other. That is the wrong shape for the one job this
 * panel has: sitting with the vendor's own app open and checking our figure
 * against theirs, night by night. A dated row per reading, values aligned on the
 * right, is a list you can run a finger down.
 *
 * The unit moves up beside the label, so seven rows do not repeat "bpm" seven
 * times, and the column stays a column of numbers.
 */
function MetricRow({ m }: { m: Metric }) {
  // Newest first: the reason somebody opens this panel is almost always the
  // most recent night.
  const points = [...m.points].sort((a, b) => b.date.localeCompare(a.date));
  const anyUnused = points.some((p) => !p.used);
  // Read off the first reading rather than the raw unit, since sleep carries
  // its units inside the figure ("6h 48m") and scores have none at all.
  const unit = points[0] ? display(m.metric, points[0].value, m.unit, m.precision).unit : "";

  return (
    <li className="iki-metric">
      <div className="iki-metric-head">
        <span className="iki-metric-icon">
          <MetricIcon metric={m.metric} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="iki-metric-label">
            {m.label}
            {unit && <span className="iki-metric-unit">{unit}</span>}
          </span>
          {/* WHAT THE NUMBER COUNTS, not what it means for the reader.
              The commonest mismatch against a vendor's own app is not the merge
              picking a different device: it is the two of us defining the same
              word differently, which happens with one device connected and no
              merge involved. Our sleep is light plus deep plus REM, so it reads
              lower than an app whose headline is time in bed. A source label
              cannot explain that; only a definition can. */}
          {m.note && <span className="iki-metric-note">{m.note}</span>}
        </div>
        <span className="iki-metric-count">
          {points.length} day{points.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="iki-metric-days">
        {points.map((p) => (
          <li key={p.date} className="iki-metric-day">
            <span>{shortDay(p.date)}</span>
            <span className={p.used ? "iki-metric-day-value" : "iki-metric-day-unused"}>
              {display(m.metric, p.value, m.unit, m.precision).value}
            </span>
          </li>
        ))}
      </ul>

      {/* Only said when it happened. A permanent legend explaining a state the
          member may never see is noise on every other visit. */}
      {anyUnused && (
        <p className="iki-metric-note">
          Struck through means another connected device supplied that day in Trends.
        </p>
      )}
    </li>
  );
}

function WorkoutRow({ w }: { w: Workout }) {
  const parts: string[] = [];
  if (w.minutes !== null) parts.push(`${w.minutes}m`);
  if (w.strain !== null) parts.push(`strain ${w.strain.toFixed(1)}`);
  if (w.calories !== null) parts.push(`${w.calories} kcal`);
  if (w.distanceM !== null && w.distanceM > 0) {
    parts.push(`${(w.distanceM / 1000).toFixed(2)} km`);
  }
  if (w.avgHeartRate !== null) parts.push(`avg ${w.avgHeartRate} bpm`);
  if (w.maxHeartRate !== null) parts.push(`max ${w.maxHeartRate} bpm`);

  return (
    <li className="iki-metric-session">
      <div className="flex items-baseline justify-between gap-3">
        {/* Capitalised on the way out: vendors send "running" and "weight
            lifting", which are ids as far as they are concerned. */}
        <span className="iki-metric-label first-letter:uppercase">
          {w.activity ?? "Session"}
        </span>
        <span className="iki-metric-note shrink-0">{shortDay(w.date)}</span>
      </div>
      {parts.length > 0 && <span className="iki-metric-note">{parts.join(" · ")}</span>}
      {/* Only one vendor tells us this. Where it is absent we say nothing,
          because "they do not say" is not the same as "they started it". */}
      {w.autoDetected && (
        <span className="iki-metric-note">
          Your device noticed this rather than you starting it.
        </span>
      )}
    </li>
  );
}

function DevicePanel({ device, days }: { device: Device; days: number }) {
  const [open, setOpen] = useState(false);
  const hasData = device.metrics.length > 0 || device.workouts.length > 0;

  return (
    <section className="iki-card flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="iki-press flex min-h-tap items-center justify-between gap-3 text-left"
      >
        <div className="flex flex-col gap-1">
          <p className="iki-eyebrow">What your {device.name} says</p>
          <span className="text-micro text-muted">
            {hasData
              ? `Exactly what it sent, last ${days} days`
              : // Said plainly rather than hidden. An empty panel with no
                // explanation reads as a bug in the app; this reads as a fact
                // about the device, which is what it is.
                "Nothing received yet"}
          </span>
        </div>
        <span className="text-micro text-primary">{open ? "Hide" : "Show"}</span>
      </button>

      {open && hasData && (
        <div className="flex flex-col gap-3">
          {device.metrics.length > 0 && (
            <ul className="flex flex-col gap-2">
              {device.metrics.map((m) => (
                <MetricRow key={m.metric} m={m} />
              ))}
            </ul>
          )}

          {device.workouts.length > 0 && (
            <div className="iki-metric gap-2.5">
              <p className="iki-eyebrow">Sessions</p>
              <ul className="flex flex-col gap-2.5">
                {device.workouts.map((w) => (
                  <WorkoutRow key={`${w.startedAt}-${w.activity ?? ""}`} w={w} />
                ))}
              </ul>
            </div>
          )}

          <p className="text-micro text-muted">
            These are the readings as stored, before Trends decides which device to
            show for each day. Anything your device records that is not listed here
            is something we do not currently read.
          </p>
        </div>
      )}

      {open && !hasData && (
        <p className="text-micro text-muted">
          Nothing has arrived in the last {days} days. A new connection can take a
          day to fill up, and some readings are only finalised hours after they are
          taken.
        </p>
      )}
    </section>
  );
}

export function DeviceDetail({ getToken }: { getToken: () => Promise<string | null> }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [days, setDays] = useState(7);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/wearables/device?days=7", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { days: number; devices: Device[] };
      setDevices(body.devices ?? []);
      setDays(body.days ?? 7);
    } catch {
      /* Trends must render with or without this */
    }
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (!devices || devices.length === 0) return null;

  return (
    <>
      {devices.map((d) => (
        <DevicePanel key={d.id} device={d} days={days} />
      ))}
    </>
  );
}
