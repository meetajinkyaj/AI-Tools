# How we combine data from several devices

Internal reference. The user-facing version of these answers is in
[`FAQ.md`](./FAQ.md); this file is the reasoning behind them, kept so the next
person to touch the merge knows which choices were deliberate and which are
simply the first thing that worked.

Implementation: [`src/lib/wearables/merge.ts`](../src/lib/wearables/merge.ts).

---

## The problem

A user can connect every provider at once, and plenty will connect two or three
a ring for sleep, a watch for training, a scale for weight. So on any given
day the same metric can arrive from several sources, and something has to decide
what "your sleep on the 4th" actually is before a chart or a model can use it.

Doing nothing is not an option. Two rows for the same night means either a chart
with two lines that disagree, or whichever row happened to sort first.

---

## What we do: rank, then fall back per day

For each metric, there is a ranked list of providers. For each day, we take the
value from the highest-ranked provider that actually has one.

**The fallback is per DAY, not per series.** That is the entire point. If the
ring was on the charger on Tuesday, Tuesday comes from the watch and the rest of
the week still comes from the ring. A per-series winner would throw Tuesday
away, which is the opposite of what connecting a second device is for.

Every stored point keeps the source it came from, so the UI can say
`Oura + Fitbit · 14 days` and a user can reconcile a specific night against the
vendor's own app.

---

## Why we do not average

Averaging is the obvious move and it is wrong here, for three reasons.

**It invents a number nobody reported.** If Oura says 7h10m and Fitbit says
6h42m, the average is 6h56m, a figure that appears in no app the user has, and
that they cannot check against anything.

**It corrupts the common case.** Devices disagree mostly when one of them was
not being worn. Averaging a real measurement with a partial one produces
something worse than either. The honest answer to "the ring was charging and the
watch logged four restless hours" is four hours, from the watch.

**It hides which device is trustworthy for what.** A ring and a wrist tracker
are not two noisy estimates of the same quantity, they are instruments with
different strengths, and blending them throws that information away instead of
using it.

---

## The ranking, and what it is based on

Four orderings cover every metric. The rankings reflect **what each device is
built to measure**, not any view about which brand is better.

| Family | Order | Why |
|---|---|---|
| Sleep, HRV, readiness, resting HR, SpO2, respiratory rate, temperature | Oura → Ultrahuman → Whoop → Garmin → Fitbit → Withings | A ring or band worn all night beats a watch that may not be worn to bed at all |
| Steps, active calories, VO₂ max | Garmin → Fitbit → Whoop → Oura → Ultrahuman → Withings | Wrist devices worn all day beat rings, which systematically under-count steps |
| Weight, body fat | Withings → Fitbit → Garmin → Oura → Ultrahuman → Whoop | A scale is the only device here that measures body composition; the rest relay or infer it |
| Glucose average, variability, time in target, estimated HbA1c, metabolic score | Ultrahuman → Oura → Whoop → Garmin → Fitbit → Withings | Only Ultrahuman reports glucose at all today. The ordering exists because every metric needs one, and "whoever actually reports it" is the right answer when a second CGM appears |

An unranked provider, one added to the adapters and forgotten here, sorts
last rather than being dropped. It gets used when it is the only source, which
degrades gracefully instead of silently losing data. There is a test for this.

`metabolic_score` is ranked like the rest, but it is the one key in the
vocabulary that is **not a quantity**: it is one vendor's composite on an
arbitrary 0-100 scale. A second vendor's 72 would not mean Ultrahuman's 72.
Treat it as a single-source series that is only ever compared to its own
history.

---

## When a blood panel and a device describe the same thing

CGM support put wearable data and lab data on the same axis for the first time,
and the intuitive rule, **"blood beats wearable"**, turns out to be wrong in at
least one place. The per-pair table is
[`src/lib/wearables/biomarker-overlap.ts`](../src/lib/wearables/biomarker-overlap.ts),
and it is the thing to read before putting any device number next to a marker.

The principle is **not instrument seniority. It is: prefer whatever measured
the quantity directly.** Everything else is an estimate, however good the
instrument that produced it.

| Device metric | Blood marker | Which one wins | Why |
|---|---|---|---|
| `hba1c_estimated` | `hba1c` | **The blood panel** | A lab measures glycated haemoglobin directly over about three months. The CGM figure is inferred from a few weeks of averages. |
| `glucose_avg` | `hba1c_eag` | **The device** | The inversion. `hba1c_eag` is not measured: it is lab HbA1c run through a population regression (`28.7 x hba1c - 46.7`, `biomarkers.ts`), and individual glycation rates vary enough to put a given person well off the line. A CGM measures mean glucose directly, thousands of times a day. |
| `glucose_avg` | `glucose_fasting` | **Neither** | Same unit, different quantity, which is the trap. Fasting glucose is one timepoint after an overnight fast; a CGM average is a 24-hour mean including every meal. |
| `metabolic_score` | `hba1c` | **Neither** | A category error rather than a disagreement. One is a vendor composite, the other a measured value with clinical thresholds. |

Three rules follow from that table.

**Respect the period.** HbA1c integrates roughly three months; a CGM average
covers the days the sensor was worn. Two numbers describing different windows
are not in conflict, and treating them as if they were manufactures a
disagreement that does not exist.

**Never merge across instrument classes.** Same reason `merge.ts` never averages
two devices: a blended number is one nobody measured and nobody can reconcile
against either source. `merge.ts` resolves *device vs device* and stops there.

**Show disagreement rather than resolving it.** When lab-derived eAG and a CGM
average diverge, the gap is the interesting part. It is the thing worth taking
to a doctor, and smoothing it away deletes the only signal in the comparison.

`biomarker-overlap.ts` is a **record, not a resolver**: nothing merges these
today. It exists so the first person to chart a device metric beside a marker
has to read the rule before they can. Its `preferBiomarker()` returns `null` for
non-comparable pairs, and callers must read that as "show both, separately",
never as "no preference, pick either".

---

## Normalization happens before the merge

The merge assumes every value is already in the same unit and on the same scale.
That is the adapters' job, at the vendor boundary
([`metrics.ts`](../src/lib/wearables/metrics.ts)):

- **Units.** Oura reports sleep in seconds, Fitbit in minutes. Everything
  becomes `sleep_minutes`.
- **Scales.** Anything ending `_score` is 0-100 by the time it leaves an
  adapter. A 0-10 score reaching a chart unscaled next to a 0-100 one would look
  like the same axis and be read that way.
- **Vocabulary.** Whoop's "recovery" and Oura's "readiness" answer the same
  question, so both land on `readiness_score`. Two keys would put one idea on
  two axes and make the charts lie by omission.
- **Derived values.** Whoop reports time in bed and time awake; asleep is the
  difference. Using in-bed directly would have overstated Whoop against every
  other provider in the same chart.

If a vendor's dialect reaches the merge, the merge is not the place to fix it.

---

## Where the merged data is used

**Trends**, a "From your devices" card, 30 days, one row per metric, naming
its sources.

**Future You**, measured sleep replaces self-reported sleep in the habit
momentum model when any device has reported in the window. Self-reported sleep
is an estimate made after the fact by somebody who was asleep for it; a wearable
knows. Users without a device keep the old path exactly.

**The merge runs server-side, once.** Both consumers call the same function.
Two implementations is how a chart and a model start disagreeing about what your
sleep was, and that disagreement is very hard to notice.

---

## Deliberately not done

These are choices, not oversights. Each has a trigger.

**The ranking is not user-overridable.** Sensible defaults first. Revisit when a
real user says the wrong device is winning, until then we would be guessing at
a preference nobody has expressed.

**No confidence or agreement signal.** We could show "your devices disagreed by
28 minutes". Interesting to us, noise to almost everyone. Revisit only if
support questions suggest people want it.

**No historical backfill on connect.** Most vendors offer months of history.
Worth adding once we know which metrics people actually look at, pulling
everything for metrics nobody opens is rate limit spent for nothing.

**Wearable data earns no points.** Steps are trivially spoofable and paying for
them invites exactly that. If this ever changes, pay once for *connecting*,
never per number.

**No cross-device conflict alerting.** If two devices disagree wildly and
persistently, that is probably a broken device or a mis-worn one, and we say
nothing. Fine at beta scale; worth revisiting if anyone reports numbers that
look wrong.

---

## What a workout is for, next to a blood panel

Written down because it was asked as an objection and answered properly, and
because the answer decides the schema.

**The naive expectation is a direct correlation, and there is not one.** A
workout does not move ApoB this week. Anyone building toward "training drops
your LDL by X" will be disappointed by the data and will build the wrong thing.

**The real path is indirect and slow.** Someone who trains eats to recover:
more protein, more fruit, more deliberate carbohydrate. They sleep differently.
They hydrate. Those behaviours move markers, and they move them over a panel
cycle, roughly six months. Training is upstream of the thing that is upstream of
the marker.

It is also not only about markers. Load-bearing exercise acts on bone density,
muscle mass and gut function, none of which a standard panel measures at all.
**The blood panel is one instrument in a wellness picture, not the definition of
health**, and a feature that only earns its place by moving a marker would
quietly encode the opposite.

### What follows for the product

**Near term, the job is training load and recovery, not correlation.** Those are
demonstrable now: how hard the last week was, whether the body is absorbing it,
how long recovery is taking. Sleep, HRV, resting heart rate and readiness are
already stored and already say most of it.

**Longer term, the correlation is a research question, not a feature.** It needs
paired data: training history alongside two or more panels from the same person,
six months apart. **Nobody has that yet**, including us. The way to have it in
2027 is to start storing training properly in 2026, which is the argument for
building this now rather than when the analysis is ready.

**So: store the sessions, ship the load and recovery signal, and leave the
biomarker claim unmade until the data supports it.** Saying "training improved
your lipids" without the evidence is the kind of claim this app must not make,
and the disclaimer exists for a reason.

### What that means for storage

A workout is a **session**: a start, an end, an intensity, a sport, several per
day. `wearable_daily_metrics` is one row per day per metric, so forcing sessions
into it means either inventing a daily aggregate or hitting the same
last-write-wins collision that naps caused in two adapters. Workouts get their
own table.

Check-ins already carry `training_logged`, so the load and recovery signal can
be built from data we hold today, and sharpens when device workouts arrive
rather than depending on them.

### What shipped: the Training and recovery card

`src/lib/training.ts`, `/api/training`, `src/app/training-card.tsx`.

**The check-in is the primary source, not the device.** The first version of
`training.ts` read wearable sessions and nothing else, and it lived under
`src/lib/wearables/`. In a beta where nobody had a ring connected, that is a
card which renders for zero people. The check-in has carried activities with a
duration bucket since migration 0003, from everybody, every day. A device
upgrades the answer from reported to measured; it is not the entry ticket. The
module moved up a directory to stop implying otherwise.

**The two sources are reconciled per day, never added.** Somebody who logs
"gym" and whose ring recorded the same hour trained once. Summing the sources
would tell them they trained twice, which is the worst thing this code could
get wrong: it would flatter the number in exactly the way a habit app must not,
and it would only start being wrong for the people who engaged most.

Per day:

| Field | Rule |
|---|---|
| Days | Union of both sources. A day counts once. |
| Sessions | The higher of the two counts, not the sum. |
| Minutes | The device's measured total when it recorded any, otherwise the check-in's bucket estimate. |
| Activities | Union of the names, deduped case-insensitively, ranked by how many days each appeared on. |

The minutes rule is the biomarker precedence rule again: **prefer whatever
measured the quantity directly.** A duration chip is a bucket we turned into a
number on the user's behalf, so any total containing one is flagged
`minutesEstimated` and the card labels it approximate. Presenting our own
arithmetic as their data is the failure mode being avoided.

**Recovery has two versions and they are labelled differently.**

`recoverySignal()` is the measured one: HRV, resting heart rate and readiness,
**two of which must agree** before it says anything, because each swings on its
own with alcohol, illness and a late meal.

`reportedRecovery()` is the check-in one: energy, corroborated or cancelled by
self-reported sleep. **Energy can carry it alone**, and that is a deliberate
departure from the two-marker rule. The device markers are proxies for a state,
so each needs a second opinion. Energy is not a proxy: asked how recovered you
feel, the answer *is* the reported measure, and demanding corroboration of the
primary source would mean it almost never fires. The bar is raised elsewhere
instead: four check-ins in each window, and half a point of movement on a five
point scale.

`recoveryView()` prefers the measured one and **falls back rather than
blending**. Averaging a reading off the body with somebody's opinion of their
morning produces a number that is neither, and there is no defensible weighting
between them. The card prints which one it used, in words, every time.

**Nothing here gives advice.** No "take a rest day", no "you are overtraining".
A test asserts that no summary contains any of those phrasings, in every branch
including the empty one. What to do about a hard week is between a person and
their doctor.

**The window ends today, not at the last check-in.** This is the opposite of
`summarizeCheckins()`, on purpose. That function answers "what do your check-ins
say", where a missed day is absence of evidence rather than a zero. This one
answers "how much did you train this week", where a day with no session **is**
the answer. Anchoring to the last workout would slide the window along and
report a fortnight off as a full training week.

**The card renders itself away** when the week held no training and recovery is
unknown. A week off is not a failure to display back at somebody.

---

## If you are changing the ranking

1. Change `SOURCE_RANK` in `merge.ts`, nothing else.
2. `merge.test.ts` asserts that every metric has a ranking and that every
   provider appears in each one exactly once. A partial edit fails.
3. Changing a ranking silently changes historical charts, because the merge runs
   at read time over stored per-provider rows. That is intentional, it means a
   better ranking improves the past too, but it does mean a user can see a
   number change without doing anything. Worth a note in a release if the change
   is large.
