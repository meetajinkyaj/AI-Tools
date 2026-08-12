"use client";

import { useCallback, useEffect, useState } from "react";

import { display } from "./metric-format";
import { MetricIcon } from "./metric-icon";

/**
 * "From your devices" in Trends.
 *
 * Shows the MERGED series, one number per metric per day, resolved server-side
 * from every connected device. The client never sees the per-provider rows and
 * never applies the resolution rules itself: the same merge feeds Future You,
 * and two implementations is how the chart and the model start disagreeing
 * about what your sleep was.
 *
 * WHAT THIS LOOKED LIKE BEFORE, and why it was rebuilt. Every row drew a
 * sparkline, including rows with two data points, where a two-point line
 * normalised to its own min and max is a 45-degree diagonal whatever the
 * numbers did. Six rows of that read as six dramatic trends and were six pieces
 * of noise. Every row also repeated the device name, so a member with one Whoop
 * read the word "Whoop" six times, and the labels wrapped to two lines around
 * the chart, so no two rows were the same height.
 *
 * The rebuild takes the shape of a device dashboard, which is what somebody
 * expects here: one tile per metric, an icon to find it by, the number large,
 * and the previous reading underneath it. The line only appears once there is
 * enough data for a line to mean something.
 *
 * WHAT IT DELIBERATELY DOES NOT DO IS JUDGE. A vendor's dashboard colours a
 * fall in HRV amber and a rise in steps green. Day to day that is mostly noise
 * being scored, and this app has already decided elsewhere (the biomarker
 * deltas, the training card) that direction of "good" is not ours to assert on
 * a single reading. The movement is shown; the verdict is not.
 */

interface Point {
  date: string;
  value: number;
  source: string;
}

interface Series {
  metric: string;
  label: string;
  unit: string;
  points: Point[];
  sources: string[];
}

/**
 * How many readings a line needs before it is drawn.
 *
 * Below this it is not a trend, it is two dots joined up, and drawing it
 * implies a movement the data cannot support. Five is the point at which a
 * shape becomes visible rather than inferred.
 */
const MIN_POINTS_FOR_LINE = 5;

/**
 * Provider ids are lowercase because they travel in URLs and file paths. Nobody
 * writes their ring's name that way, so it gets capitalised on the way out.
 */
const BRAND: Record<string, string> = {
  oura: "Oura",
  fitbit: "Fitbit",
  // Caps, per their brand guidelines. See PROVIDER_NAMES in wearables/types.
  whoop: "WHOOP",
  withings: "Withings",
  garmin: "Garmin",
  ultrahuman: "Ultrahuman",
};

function brandName(id: string): string {
  return BRAND[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When a reading is from, in the terms somebody would use out loud.
 *
 * THE NUMBER IS NOT NECESSARILY TODAY'S, and a large number with no date on it
 * is read as current. A strap left on the charger for three days would show a
 * three-day-old resting heart rate as though it were this morning's, which is
 * exactly the kind of quiet wrongness this app cannot afford.
 *
 * Compared as calendar dates in the reader's own zone: these are days, not
 * instants, and `Date.parse` on a bare date is midnight UTC, which lands on the
 * wrong side of "yesterday" for most of the world.
 */
export function recencyLabel(date: string, today: string): string {
  if (date === today) return "Today";

  const [y, m, d] = date.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  if (!y || !m || !d || !ty || !tm || !td) return "";

  const days = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000,
  );
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  return `${d} ${MONTHS[m - 1] ?? ""}`.trim();
}

/**
 * The small print under a metric: whose it is, when it is from, how much of it
 * there is.
 *
 * COVERAGE IS PART OF THE READING. A resting heart rate drawn from two days and
 * one drawn from thirty deserve different confidence, and only one of them says
 * so on its own. It stays even when the line is drawn, because the line shows
 * the shape and not the sample size.
 */
export function rowNote(
  s: Pick<Series, "sources" | "points">,
  today: string,
  withSource: boolean,
): string {
  const latest = s.points[s.points.length - 1];
  return [
    withSource ? s.sources.map(brandName).join(" + ") : null,
    latest ? recencyLabel(latest.date, today) : null,
    `${s.points.length} day${s.points.length === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Today, as a calendar date in the reader's own timezone. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Which way the latest reading moved, with no opinion about whether that is good. */
export function movement(latest: number, previous: number): "up" | "down" | "level" {
  // A rounding-level difference is not a movement. Sleep in minutes and steps
  // in thousands both routinely differ by a hair, and an arrow on a 0.1%
  // change is a claim the data is not making.
  const span = Math.max(Math.abs(latest), Math.abs(previous), 1);
  if (Math.abs(latest - previous) / span < 0.005) return "level";
  return latest > previous ? "up" : "down";
}

const ARROW: Record<"up" | "down" | "level", string> = {
  up: "↑",
  down: "↓",
  level: "·",
};

/**
 * The 30-day shape, drawn full width under the numbers.
 *
 * Stretched with `preserveAspectRatio="none"` so it fills whatever width the
 * tile has: the old one was a fixed 120px box wedged between the label and the
 * value, which is what forced every long label onto two lines.
 */
function Sparkline({ points }: { points: Point[] }) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const w = 100;
  const h = 20;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      // A flat series has no shape; drawn against a zero span it would sit on
      // the floor of the box and read as a collapse rather than as steadiness.
      const y = span === 0 ? h / 2 : h - ((p.value - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
      className="iki-metric-spark"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function WearableTrends({ getToken }: { getToken: () => Promise<string | null> }) {
  const [series, setSeries] = useState<Series[] | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/wearables/metrics?days=30", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { series: Series[] };
      setSeries(body.series ?? []);
    } catch {
      /* Trends must render with or without devices */
    }
  }, [getToken]);

  useEffect(() => {
    // Wrapped rather than `void load()` so the lint rule can see that every
    // setState happens after an await, not synchronously inside the effect.
    void (async () => {
      await load();
    })();
  }, [load]);

  // Nothing connected, or nothing synced yet: show nothing at all rather than
  // an empty card. The pitch to connect lives on Home and in Settings; this
  // section only exists once there is something to look at.
  if (!series || series.length === 0) return null;

  const today = localToday();
  /*
   * THE DEVICE NAME IS SAID ONCE, IN THE HEADER, when there is only one.
   *
   * It used to sit on every row, so a member with a single strap read "Whoop"
   * six times down the card and learned nothing from five of them. With two
   * devices it goes back onto the rows, because then it is the answer to a real
   * question: which of my devices is this number from.
   */
  const devices = [...new Set(series.flatMap((s) => s.sources))];
  const perRowSource = devices.length > 1;

  const notes = series.map((s) => rowNote(s, today, perRowSource));
  /*
   * THE SAME LOGIC APPLIED TO THE REST OF THE NOTE.
   *
   * One device syncing nightly gives every metric the same date and the same
   * coverage, so the line under each label is identical six times over: the
   * screenshot that started this rebuild said "Whoop · 2 days" on every row.
   * When it is the same for all of them it belongs in the header, said once.
   * The moment one metric is staler or thinner than the others, that difference
   * is worth seeing, and the notes come back down onto the rows.
   */
  const sharedNote = new Set(notes).size === 1 ? notes[0] : null;

  return (
    <section className="iki-card flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <p className="iki-eyebrow">From your devices</p>
        <p className="text-micro text-muted">
          {[devices.map(brandName).join(" + "), sharedNote ?? "last 30 days"]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {series.map((s, i) => {
          const latest = s.points[s.points.length - 1];
          const previous = s.points.length > 1 ? s.points[s.points.length - 2] : null;
          const shown = display(s.metric, latest.value, s.unit);
          const was = previous ? display(s.metric, previous.value, s.unit) : null;
          const dir = previous ? movement(latest.value, previous.value) : null;

          return (
            <li key={s.metric} className="iki-metric">
              <div className="iki-metric-head">
                <span className="iki-metric-icon">
                  <MetricIcon metric={s.metric} />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="iki-metric-label">{s.label}</span>
                  {!sharedNote && <span className="iki-metric-note">{notes[i]}</span>}
                </div>
                <div className="iki-metric-figures">
                  <span className="iki-metric-value">
                    {shown.value}
                    {shown.unit && <span className="iki-metric-unit">{shown.unit}</span>}
                  </span>
                  {was && dir && (
                    <span className="iki-metric-delta">
                      <span aria-hidden>{ARROW[dir]}</span> was {was.value}
                    </span>
                  )}
                </div>
              </div>

              {s.points.length >= MIN_POINTS_FOR_LINE && <Sparkline points={s.points} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
