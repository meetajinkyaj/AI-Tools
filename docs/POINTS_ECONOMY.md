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
| 2 | 7-day streak bonus | **50** | whenever the streak hits exactly 7 | ✅ | ✅ |
| 3 | 30-day streak bonus | **250** | whenever the streak hits exactly 30 | ✅ | ✅ |

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

## ⚠️ A discrepancy this review found

**Breaking your streak on purpose currently earns more than keeping it.**

The streak bonus fires only when the streak equals *exactly* 7 or 30. Maintain a
365-day streak and you collect the 7-day bonus once and the 30-day bonus once —
nothing after that. Cycle 7 days on, 1 day off, and you collect 50 points every
8 days, forever.

| Days | Perfect streak | 7-on-1-off cycler | Cycler ahead by |
|---|---|---|---|
| 30 | 600 | 420 | −180 |
| 60 | 900 | 880 | −20 |
| **90** | 1,200 | 1,340 | **+140** |
| **180** | 2,100 | 2,680 | **+580** |
| **365** | 3,950 | 5,450 | **+1,500 (38% more)** |

Past about two months, the economy pays people to break the habit it exists to
build. Nobody is doing this today — the app is too young — but it is worth
fixing before it is discovered rather than after.

**Recommended fix:** award each streak bonus **once ever, on personal best**,
and extend the ladder so long streaks keep paying:

| Streak reached (first time ever) | Points |
|---|---|
| 7 days | 50 |
| 30 days | 250 |
| 90 days | 500 |
| 180 days | 1,000 |
| 365 days | 2,500 |

Farming stops working entirely (a bonus you have already collected can't be
collected again), and someone 200 days deep still has something to climb toward
— which today they do not.

---

## Open questions

1. **Activity floor** — how many check-ins in the first 90 days keep a partner
   user at 1.5× instead of dropping to 1.25×? Currently assumed **45**.
2. **Streak fix** — adopt the personal-best ladder above, or leave as-is?
3. **Welcome grant** — 150 points, spendable only, not counted toward rank.
   Confirm the amount.
