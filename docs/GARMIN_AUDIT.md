# Garmin push endpoint: audit

Written 2026-08-02, before portal access. Audits
`src/app/api/wearables/garmin-push/route.ts` and the Garmin adapter against the
correctness problems a push integration has to solve.

**Six items. Three are already handled, two are real gaps, one does not apply
to our storage model.** Nothing here has been exercised against real Garmin
traffic, because we have no credentials yet.

---

## Summary

| # | Concern | Status |
|---|---|---|
| 1 | Corrected summaries overwrite, not duplicate | ✅ Already correct |
| 2 | Redelivery is a no-op | ✅ Already correct |
| 3 | "Zero" distinguishable from "not available" | ✅ Already correct |
| 4 | Time zone / offset handling | ⚠️ Does not apply as posed, but one real bug adjacent to it |
| 5 | Fast acknowledgement | ⚠️ Real, deferred with a trigger |
| 6 | Deregistration and permission change | 🔴 Real gap, compliance |

---

## 1. Corrected summaries. Already correct

Garmin re-sends summaries as they finalise: a sleep summary settles hours after
waking, an activity gets edited.

`storeMetrics` upserts with `onConflict: "user_id,provider,metric_date,metric"`,
matching the unique index `wearable_daily_metrics_key` created in migration
0015. A corrected summary for the same day and metric **overwrites in place**.

**The brief's framing does not map onto us, and that is worth understanding.**
It asks us to key on "the stable identity of the summary". We do not store
summaries. We store one row per user, provider, day and metric, so the day and
metric together *are* the identity at our grain. There is no summary id to key
on because there is no summary row. This is why re-pulling a window is safe for
every provider, not just Garmin.

## 2. Redelivery. Already correct

Same mechanism. A duplicate push writes the same values to the same rows. No
duplicate row, no second point on any axis.

## 3. Zero versus not available. Already correct

The concern is real: if a user grants sleep but not activity, "no steps data"
must not render as "0 steps".

Our model expresses this without a migration. `num()` in
`src/lib/wearables/http.ts` checks `typeof v === "number" && Number.isFinite(v)`,
so a genuine `0` passes through and stores a row containing zero. An absent or
null field returns `undefined`, `metric()` returns `null`, and **no row is
written at all**.

So absence of a row means "not available" and a row containing `0` means zero.
The read path can already tell them apart. No change needed.

## 4. Time and offset. Does not apply as posed

The brief asks us to store Garmin's UTC start seconds alongside the local
offset, and never collapse to local time at write.

We store neither, because we store no timestamps. `wearable_daily_metrics` has
`metric_date`, a `date`. Daily metrics are a per-day grain by construction, so
there is no instant to preserve.

**But there is a real bug next to this.** In `metric()`:

```ts
const date = s.calendarDate ?? s.calendarDateLocal;
```

`calendarDateLocal` was invented when this code was written. Whether Garmin
sends it, and which field is authoritative per summary type, is unverified. If
dailies and sleeps define "the day" differently, a night's sleep could land on
the wrong date, which is the kind of error that looks like bad data rather than
bad code.

**Blocked on portal access.** Do not guess a field name here.

## 5. Fast acknowledgement. Real, deferred

The handler currently parses, selects connections, writes metrics, and only
then responds. Garmin retries on non-2xx and disables endpoints that keep
failing, so a slow handler under a large batch is a genuine risk.

`waitUntil` is the right answer on Cloudflare Workers. No queue, no new
infrastructure, as the brief says.

**Deferred deliberately, with a trigger.** Two reasons:

1. **It is not a risk at our size.** A push costs one `select` plus a handful
   of upserts. Workers allow far more than that. The failure needs batch sizes
   we will not see below a few hundred connected users.
2. **It trades one failure mode for another, and the new one is quieter.**
   Acking before the write means a failed write becomes invisible to Garmin:
   no retry, no error, data silently missing. Today a failed write returns
   non-2xx and Garmin retries. Moving to `waitUntil` without somewhere to
   record failed writes makes the system less honest, not more robust.

**Trigger:** implement when connected Garmin users pass ~100, or when the first
push timeout appears in Worker logs. Pair it with a failure record so a dropped
write is visible.

## 6. Deregistration and permission change. Real gap

Garmin notifies when a user disconnects at their end, or narrows what they have
granted. Acting on both is a compliance requirement: continuing to hold data
for a user who revoked consent is the problem, not the inconvenience.

**We handle neither.** The handler reads only `dailies`, `sleeps` and `hrv`
from the payload. Any other push shape falls through to `byUser.size === 0` and
returns `{ ok: true, stored: 0 }`. A deregistration is acknowledged and
silently discarded, which is the worst of both: Garmin believes we were told,
and we did nothing.

**The plan, not the code**, because the payload shapes need verifying:

1. Recognise the deregistration and permission-change payloads by their top
   level key, alongside the existing three.
2. On deregistration: delete the `wearable_connections` row for that
   `external_user_id`. This already happens on user-initiated disconnect, so
   the deletion path exists; only the trigger is missing. Decide explicitly
   whether previously-synced metrics are also deleted. **They probably should
   be**, and that decision belongs with the founder, not with this document.
3. On permission change: re-read what is now granted and stop syncing what is
   not. With no per-metric permission state stored, this may need a column.
4. Both must be idempotent, like everything else here.

**Blocked on portal access** for the exact key names and payload shapes.

---

## What is not blocked

Nothing in items 1 to 3: they are already correct and were verified by reading
the code and the migration, not assumed.

Items 4 and 6 are blocked on Garmin's documentation. Item 5 is not blocked, it
is deferred on purpose, and the reasoning is above so the next person can
disagree with it on the merits.
