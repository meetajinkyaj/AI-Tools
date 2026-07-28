# The iki points economy — every way to earn

_Last updated: 2026-07-28. Under review — see "Open questions" at the bottom._

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
| 3 | 30-day streak | **250** | once ever, on personal best | ✅ | ✅ |
| 3b | 90-day streak | **500** | once ever, on personal best | ✅ | ✅ |
| 3c | 180-day streak | **1,000** | once ever, on personal best | ✅ | ✅ |
| 3d | 365-day streak | **2,500** | once ever, on personal best | ✅ | ✅ |

### Lab panels — the most valuable data ask

| # | Earn | Points | How often | Boost? | Rank? |
|---|---|---|---|---|---|
| 4 | First panel ever uploaded | **200** | once, ever | ✅ | ✅ |
| 5 | Re-test uploaded | **150** | per genuinely new *dated* panel | ✅ | ✅ |
| 6 | Outcome bonus | **250 per marker** | per marker that measurably improved vs the previous panel | ✅ | ✅ |

Re-uploading the same report earns nothing — panels are matched on content
signature, not on the (user-editable) test date.

### Referrals — paid to **the referrer**, for a friend's behaviour

| # | Earn | Points | How often | Boost? | Rank? |
|---|---|---|---|---|---|
| 7 | Friend completes onboarding | **100** | once per friend | ❌ | ✅ |
| 8 | Friend reaches a 7-day streak | **50** | once per friend | ❌ | ✅ |
| 9 | Friend uploads first panel within 30 days | **150** | once per friend | ❌ | ✅ |
| 10 | **7 friends onboarded** 🆕 | **50** | once, ever | ❌ | ✅ |
| 11 | **30 friends onboarded** 🆕 | **250** | once, ever | ❌ | ✅ |

Maximum **300 per friend** (7 + 8 + 9), plus the milestones at 7 and 30.

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

| Rank | Iki score | Roughly, for a committed user |
|---|---|---|
| Iki Rookie 🌱 | 0 | start |
| Iki Apprentice 🛠️ | 400 | ~1 month |
| Iki Pro ⚡ | 2,000 | ~5 months |
| Iki Sensei 🥋 | 8,000 | ~14 months |
| Iki Grandmaster 🏆 | 25,000 | ~4 years — hidden until reached |

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

## Open questions

1. ~~Activity floor~~ — **confirmed: 45 check-ins in the first 90 days.**
2. ~~Streak fix~~ — **confirmed: personal-best ladder, 7/30/90/180/365.**
3. **Welcome grant** — 150 points, spendable only, not counted toward rank.
   Still assumed; confirm the amount when the first partner is signed.
