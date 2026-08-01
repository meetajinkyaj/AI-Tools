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

Three orderings cover every metric. The rankings reflect **what each device is
built to measure**, not any view about which brand is better.

| Family | Order | Why |
|---|---|---|
| Sleep, HRV, readiness, resting HR, SpO2, respiratory rate, temperature | Oura → Ultrahuman → Whoop → Garmin → Fitbit → Withings | A ring or band worn all night beats a watch that may not be worn to bed at all |
| Steps, active calories, VO₂ max | Garmin → Fitbit → Whoop → Oura → Ultrahuman → Withings | Wrist devices worn all day beat rings, which systematically under-count steps |
| Weight, body fat | Withings → Fitbit → Garmin → Oura → Ultrahuman → Whoop | A scale is the only device here that measures body composition; the rest relay or infer it |

An unranked provider, one added to the adapters and forgotten here, sorts
last rather than being dropped. It gets used when it is the only source, which
degrades gracefully instead of silently losing data. There is a test for this.

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

## If you are changing the ranking

1. Change `SOURCE_RANK` in `merge.ts`, nothing else.
2. `merge.test.ts` asserts that every metric has a ranking and that every
   provider appears in each one exactly once. A partial edit fails.
3. Changing a ranking silently changes historical charts, because the merge runs
   at read time over stored per-provider rows. That is intentional, it means a
   better ranking improves the past too, but it does mean a user can see a
   number change without doing anything. Worth a note in a release if the change
   is large.
