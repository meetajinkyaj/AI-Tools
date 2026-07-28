# Cowork prompt — apply migration 0013 to production Supabase

Paste everything below the line into Claude Cowork.

---

Apply migration `0013_points_rank_split.sql` to the **production** Supabase
project for Ikigaro (`xaygldulkjjofxohescm`), using the SQL Editor in the
Supabase dashboard.

**Ordering matters.** This migration must be applied BEFORE PR #64 is merged.
The code in that PR reads columns this migration creates, on the check-in path,
the biomarker upload path, and signup. If the code ships first, every check-in
returns a 500. Applying the migration first is safe on its own — the currently
deployed code doesn't read any of the new columns, so production keeps working
normally in the gap between the migration and the merge.

## The SQL

Take the file verbatim from the branch — do not retype it or reconstruct it
from this prompt:

https://github.com/meetajinkyaj/AI-Tools/blob/claude/points-rank-split/supabase/migrations/0013_points_rank_split.sql

Paste the whole file into the SQL Editor and run it as one statement batch. It
is idempotent (every `add column` is `if not exists`, every backfill is guarded
on the default value), so a partial run can be re-run safely.

## Before you run it

Note the current row counts so the backfill can be checked afterwards:

```sql
select
  (select count(*) from users)                                as users,
  (select count(*) from users where referral_code is not null) as users_with_code,
  (select count(*) from points_transactions where type = 'earn') as earn_rows,
  (select count(*) from daily_checkins)                        as checkins;
```

## After you run it — verification

Run all five. Report the output of each.

**1. The new columns exist on `users`.** Expect exactly 6 rows.

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'users'
   and column_name in ('iki_score','accelerated_partner','boost_started_at',
                       'boost_floor_met','best_streak','partner_id')
 order by column_name;
```

**2. The new tables exist.** Expect `partners` and `invite_codes`.

```sql
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('partners','invite_codes');
```

**3. `iki_score` and `best_streak` were backfilled from real history.**

```sql
select u.email,
       u.iki_score,
       coalesce(e.total, 0) as ledger_earned,
       u.best_streak,
       coalesce(c.peak, 0)  as history_peak
  from users u
  left join (select user_id, sum(coalesce(base_amount, amount)) as total
               from points_transactions where type = 'earn' group by user_id) e
         on e.user_id = u.id
  left join (select user_id, max(streak_count) as peak
               from daily_checkins group by user_id) c
         on c.user_id = u.id
 order by u.iki_score desc
 limit 20;
```

`iki_score` should equal `ledger_earned` and `best_streak` should equal
`history_peak` for every row. **If any row disagrees, stop and report it — do
not merge the PR.** A mismatch means someone's lifetime score is wrong, and it
gets harder to unwind once new points start landing on top of it.

Note: `ledger_earned` deliberately counts `type = 'earn'` only. Redemption rows
store a *positive* amount with `type = 'redeem'`, so counting everything would
inflate the score by whatever people have spent. If you see redemptions in the
data, that filter is why.

**4. The invite-code triggers are live.** Expect 2 rows.

```sql
select tgname, tgrelid::regclass as on_table, tgenabled
  from pg_trigger
 where tgname in ('users_invite_code_sync','partners_invite_code_sync');
```

`tgenabled` should be `O` (enabled).

**5. Existing user codes were adopted into the namespace.**

```sql
select (select count(*) from users where referral_code is not null) as user_codes,
       (select count(*) from invite_codes where kind = 'user')      as adopted;
```

These two numbers must match. If `adopted` is lower, two users share a code
(case-insensitively) — report which ones rather than guessing at a fix:

```sql
select upper(referral_code) as code, count(*), array_agg(email)
  from users where referral_code is not null
 group by 1 having count(*) > 1;
```

## Do not

- Do not modify, insert, or delete any user data beyond what the migration file
  itself does.
- Do not create any partner rows yet. Partners get created through the admin
  console after the PR is merged, so the code path gets exercised properly.
- Do not paste any keys, tokens, or connection strings into chat.

## Report back

- Whether the migration ran clean, and any error text if not
- The output of all five verification queries
- Whether query 3 matched on every row

Once that's confirmed, PR #64 is clear to merge.
