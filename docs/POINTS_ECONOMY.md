# The iki points economy — every way to earn

_Last updated: 2026-07-28. Emissions revised down; all values confirmed._

Two separate ledgers. This split is the load-bearing decision in the whole
system:

| | **Iki points** (`reward_points.points_balance`) | **Iki score** (`users.iki_score`) |
|---|---|---|
| What it's for | spending on vouchers | rank, status, identity |
| Multiplier | **2× applies** | **never — always base** |
| Redeeming | goes down | untouched |
| Direction | up and down | only ever up |

**Rank can't be bought.** Two people at Iki Sensei did the same amount of work,
whether or not either arrived through a partner code — because rank counts base
points only. And spending never demotes you, or the reward system would punish
the behaviour it exists to reward.

---

## Every earn

`Boost?` = does the Accelerated Points multiplier apply.
`Rank?` = does it raise lifetime iki score.

### Daily habit — paid to you, for what you did

| # | Earn | Points | How often | Boost? | Rank? |
|---|---|---|---|---|---|
| 1 | Daily check-in | **10** | once per day | ✅ | ✅ |
| 2 | 7-day streak | **50** | once ever, on personal best | ✅ | ✅ |
| 3 | 30-day streak | **150** | once ever, on personal best | ✅ | ✅ |
| 3b | 90-day streak | **250** | once ever, on personal best | ✅ | ✅ |
| 3c | 180-day streak | **500** | once ever, on personal best | ✅ | ✅ |
| 3d | 365-day streak | **1,000** | once ever, on personal best | ✅ | ✅ |

### Lab panels — the most valuable data ask

| # | Earn | Points | How often | Boost? | Rank? |
|---|---|---|---|---|---|
| 4 | First panel ever uploaded | **200** | once, ever | ✅ | ✅ |
| 5 | Re-test uploaded | **150** | per genuinely new *dated* panel | ✅ | ✅ |
| 6 | Outcome bonus | **50 per marker** | per marker that measurably improved vs the previous panel | ✅ | ✅ |

Re-uploading the same report earns nothing — panels are matched on content
signature, not on the (user-editable) test date.

### Referrals — paid to **the referrer**, for a friend's behaviour

| # | Earn | Points | How often | Boost? | Rank? |
|---|---|---|---|---|---|
| 7 | Friend completes onboarding | **100** | once per friend | ❌ | ✅ |
| 8 | Friend reaches a 7-day streak | **50** | once per friend | ❌ | ✅ |
| 9 | Friend uploads first panel within 30 days | **150** | once per friend | ❌ | ✅ |
| 10 | **7 friends onboarded** 🆕 | **50** | once, ever | ❌ | ✅ |
| 11 | **30 friends onboarded** 🆕 | **150** | once, ever | ❌ | ✅ |

Maximum **300 per friend** (7 + 8 + 9), plus the milestones at 7 and 30. The
milestone amounts mirror the check-in streak ladder, so tier 30 follows the
30-day streak bonus down to 150.

**Why referrals never boost:** these pay you for someone *else's* behaviour.
Doubling them rewards recruiting over health, and hands partner-code users a
permanently better rate at farming signups than everyone else.

**Why 10 and 11 count onboarded friends, not signups:** a signup that never
onboards costs nothing to create. Counting completions means the milestone
tracks real people.

### Partner activation — Accelerated Points

| # | Earn | Points | How often | Boost? | Rank? |
|---|---|---|---|---|---|
| 12 | Welcome grant | **150** | once, on signup via a partner code | n/a | ❌ |

Granted the moment a partner-code signup completes, before the user has done
anything. "Endowed progress": starting at zero is the most abandonable state
there is, and a balance that is already moving is far more likely to be
continued than one that has not started.

**The only earn that doesn't count toward rank.** A gift isn't work — if it
raised your score, a community code would buy status.

### The multiplier itself

Applies to rows 1–6 only, and decays:

| Days since joining via a partner code | Multiplier |
|---|---|
| 0–90 | **2.00×** |
| 91–180, if the activity floor was met | **1.50×** |
| 91–180, if it was missed | **1.25×** |
| 181+ | **1.25×** |

Snapshotted at signup. Switching a partner off stops *new* signups getting it
and never downgrades anyone already in.

---

## The rank ladder

Driven by lifetime iki score.

### How long each rank takes

Simulated day by day on the revised numbers, not estimated. **Consistent** =
checks in daily, first panel at day 30, re-tests every 4 months (3 markers
improving each time), refers 2 friends in year one. **Casual** = checks in twice
a week, first panel at day 60, one re-test, 1 marker improving, no referrals.

| Rank | Iki score | Consistent | Casual |
|---|---|---|---|
| Iki Rookie 🌱 | 0 | day 1 | day 1 |
| Iki Apprentice 🛠️ | 400 | **day 30** | **2 months** |
| Iki Pro ⚡ | 2,000 | **4 months** | **1.5 years** |
| Iki Sensei 🥋 | 8,000 | **1.2 years** | **5.9 years** |
| Iki Grandmaster 🏆 | 25,000 | **4.9 years** | not within 6 years |

The gap is the point. A casual user still climbs — they reach Apprentice in
their second month and Pro eventually — but Sensei is genuinely a marker of
sustained consistency rather than of having been signed up a long time.

---

## What changed in the revision, and why it still works

| Earn | Was | Now |
|---|---|---|
| 30-day streak | 250 | **150** |
| 90-day streak | 500 | **250** |
| 180-day streak | 1,000 | **500** |
| 365-day streak | 2,500 | **1,000** |
| Outcome bonus | 250/marker | **50/marker** |
| 30 friends onboarded | 250 | **150** |

The outcome bonus took the largest cut, 5×, and it is the right one to cut. At
250 per marker a single good re-test improving six markers paid 1,500 — more
than a fortnight of perfect check-ins, from one lab visit the user only
partly controls. At 50 it is a meaningful nudge rather than the dominant
earn.

**Rank thresholds did not need moving.** Lower streak and outcome values are
largely offset by the ladder now running to 365 days, so a consistent user
still reaches Sensei in about 14 months — the pacing the thresholds were
fitted to in the first place.

---

## ✅ Fixed in this pass: the streak-farming hole

Streak bonuses used to fire whenever the streak *equalled* exactly 7 or 30. A
perfect 365-day streak collected two bonuses and nothing for the remaining 335
days; cycling 7-on/1-off collected 50 every eight days forever. Past ~90 days
the farmer was ahead — by a year, **38% ahead**.

Milestones now pay **once ever, keyed off the personal best** (`users.best_streak`).
A bonus already collected cannot be collected again, whatever shape the streak
takes, so farming stops working entirely. The ladder also runs to a year, so
someone 200 days deep still has something ahead of them — under the old rule
they had nothing after day 30.

Existing users keep what they built: the migration seeds `best_streak` from
check-in history rather than making anyone start again.

---

## Settled

| Decision | Value |
|---|---|
| Activity floor (keeps 1.5× at day 90) | **45 check-ins in the first 90 days** |
| Streak milestones | **Personal best — 7 / 30 / 90 / 180 / 365** |
| Welcome grant | **150 points, spendable only, never toward rank** |
| Rank thresholds | **0 / 400 / 2,000 / 8,000 / 25,000** |
| Grandmaster | **Hidden until reached** |

Every one of these is a single named constant. Retuning any of them is a
one-line change plus a deploy — no migration, no backfill.
