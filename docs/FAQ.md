# Ikigaro. FAQ (rewards & trends)

Plain-language answers about iki points, rewards, and how trends work.

**`src/lib/points.ts` is the source of truth for every number below.** The
Trends screen interpolates its copy straight from it, so the app is always
right; this file is written by hand and is the one that drifts. It did drift
once, the 30-day streak bonus was cut and this page kept quoting the old,
higher figure for weeks. `src/lib/docs-drift.test.ts` now fails CI if the two
disagree, so retuning the economy will tell you to come back here.

## How do I earn iki points?

- **Daily check-in**, 10 points for your first check-in each day.
- **Streak bonuses**, 50 at a 7-day streak, 150 at 30, 250 at 90, 500 at 180,
  1,000 at a full year. Each is paid **once ever**, the first time you reach
  that streak length, so a broken streak costs you the run, not the reward you
  already earned.
- **First lab panel**, 200 points for uploading your first blood report (the
  most valuable thing you can do for your baseline).
- **Re-test**, 150 points for each genuinely new panel after that
  (re-uploading the same report earns nothing).
- **Outcome-verified improvement**, 50 points per marker that genuinely
  improves between two lab panels, up to 3 markers per panel (see below).
- **Referrals**, up to 300 points per friend, milestone by milestone, plus
  50 when 7 friends have onboarded and 150 at 30 (see "How do referrals work?").
- **Welcome grant**, 150 points if you joined through a partner code. Spendable
  straight away; it does not count toward your rank.

## What's the difference between points and my Iki Score?

Two different things, deliberately.

**Points** are the currency. You spend them on rewards, and they go down when
you do.

**Iki Score** is your record. It only ever goes up, it counts the base value of
everything you have earned, and spending never touches it. Your rank comes from
this, so redeeming a voucher can never demote you.

## How do ranks work?

Four ranks, earned on Iki Score:

| Rank | Iki Score |
|---|---|
| 🌱 Iki Rookie | 0 |
| 🛠️ Iki Apprentice | 400 |
| ⚡ Iki Pro | 2,000 |
| 🥋 Iki Sensei | 8,000 |

Ranks never go down, and there is no time limit. A rank tracks what you have
accumulated, not how fast, so checking in steadily gets you there whether that
takes months or years.

*(There is one more above Sensei. You will find out.)*

## What is Accelerated Points?

If you joined through a partner's invite code (a gym, a community, a brand)
you earn at a boosted rate: 2x for your first 90 days, then 1.5x for the next
90 if you have kept checking in, then 1.25x from there.

The boost applies to **spendable points only**. Your Iki Score, and so your
rank, always counts the base amount. Two people at the same rank did the same
amount of work, whichever door they came in through.

## Can I connect more than one device?

Yes, connect as many as you like. A ring, a watch and a scale together give a
fuller picture than any one of them, and there is no limit.

## What happens if two devices disagree?

For each day, we use the device best suited to that measurement, and fall back
to another one when the first has nothing.

So if your ring was charging on Tuesday night, Tuesday's sleep comes from your
watch and the rest of the week still comes from the ring. **You get a complete
picture instead of gaps.** Every number tells you which device it came from.

**We never average two devices together.** Averaging would produce a number
neither device actually recorded, which you could not check against either app.
We would rather show you one real measurement than a blend of two.

## Which device wins for which measurement?

Whichever one is built to measure it.

- **Sleep, HRV, recovery**, a ring or band worn all night, ahead of a watch you
  may not sleep in.
- **Steps and activity**, a watch or tracker worn all day, ahead of a ring
  (rings under-count steps).
- **Weight and body composition**, your scale, since nothing else actually
  measures it.

## Do my devices change my Iki points or rank?

No. Points and rank come from checking in, uploading panels, and the outcomes
that follow, things you do. Connecting a device doesn't earn points and doesn't
affect your rank.

## Where does my device data show up?

In **Trends**, as a "From your devices" card covering the last 30 days.

It also improves **Future You**: if a device has recorded your sleep, we use the
measured figure instead of the hours you type into your check-in. A wearable
knows what you actually got; the check-in is your best guess afterwards.

## Can I disconnect a device?

Any time, from Settings. Disconnecting deletes our permission to read from that
service immediately. Data already synced stays in your history unless you delete
your account.

## What is an "outcome-verified" reward?

Points for a marker moving in its **healthy direction** between two lab panels, and we keep rewarding **continued** improvement, not just the first time it
reaches the normal range. For example, visceral fat going 9 → 8 → 6.5 earns a
reward at each step, even after it's already in a healthy range.

"Healthy direction" depends on the marker: lower is better for things like LDL,
HbA1c, and visceral fat; higher is better for HDL and Vitamin D; two-sided
markers (e.g. electrolytes) improve by moving toward the normal range.

## How often can a lab panel earn improvement rewards?

At most once every **14 days**. Panels uploaded closer together than that are
**still saved and still shown in your trends**, they're important health data, but they don't earn improvement points.

## Why the 14-day rule?

During illness, hospitalization, or recovery, your blood markers can swing a lot
white and red blood cells especially, as your body fights infection and
recovers. Rewarding rapid re-tests would misread that noise as "improvement."
The bi-weekly floor keeps rewards tied to genuine change, while still recording
every result in your trends so you and your doctor can see the full picture.

## What exactly counts as an improvement?

- A move in the healthy direction that's **big enough to be real** (a small
  percentage of the previous value), so normal test-to-test fluctuation doesn't
  count.
- Up to **3 markers** rewarded per panel.
- Based on your values after they've been normalized to standard units, so unit
  differences between labs can't be used to game it.

## Are results that don't earn points still saved?

Yes. Every panel you upload is stored and becomes part of your trends and your
doctor-ready history. Rewards are a bonus for genuine progress, never a gate on
your own data.

## Is any of this medical advice?

No. Everything in Ikigaro is **educational, not a diagnosis. Please consult a
doctor.** Rewards are for engagement and genuine self-improvement, not a medical
claim or an inducement.

## How do I redeem my iki points?

Spend points in **Rewards** (the Partners tab):

- **Vouchers**, redeem points for a partner voucher and the code appears
  **instantly**. Copy it, and it's also saved in your **Redemption history** so
  you can come back to it anytime. Follow the short redemption steps shown with
  the code (usually: paste it at the partner's checkout).
- **Shop our picks**, curated products we'd use ourselves. These are free to
  open; no points are spent.

Vouchers are single-use and may carry an expiry or minimum spend, check the
terms shown on each voucher before you redeem.

## What happens to points when I redeem?

They're deducted from your balance the moment a voucher code is issued, and the
redemption is logged in your history. If a voucher is sold out or you don't have
enough points, nothing is deducted.

## How do referrals work?

Share your invite link from **Rewards → Invite friends**. You can earn up to
**300 iki points per friend**, paid as they hit real milestones:

- **+100** when they join through your link and complete onboarding.
- **+50** when they build the daily habit, their first 7-day check-in streak.
- **+150** when they upload their first blood report within **30 days** of
  joining.

Each milestone pays **once per friend**. Signups alone earn nothing, the
rewards follow genuine engagement, so the programme can't be farmed with
throwaway accounts. Values may be tuned over time; the invite card always
shows the current ones.
