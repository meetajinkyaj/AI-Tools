# Cowork prompt — apply migration 0014 to production Supabase (priority)

This follows the 0013 run. The RLS warning Supabase showed during that run was
correct and the omission was a real exposure, live on production from the moment
0013 was applied. 0014 closes it. Run it now — it does not wait on PR #64.

Paste everything below the line into Claude Cowork.

---

Apply migration `0014_rls_on_partners_and_invite_codes.sql` to the **production**
Supabase project for Ikigaro (`xaygldulkjjofxohescm`), using the SQL Editor.

This is a two-line follow-up to 0013. When 0013 ran, the dashboard warned that
`partners` and `invite_codes` were created without Row Level Security. That
warning was right. Supabase grants the `anon` and `authenticated` roles
privileges on everything in the `public` schema, and the anon key ships inside
the client JavaScript bundle, so those two tables are currently readable and
writable by anyone who opens the app. Every other table in this database has
had RLS enabled since migration 0001.

Run it as one batch:

```sql
alter table partners     enable row level security;
alter table invite_codes enable row level security;
```

Or take the file verbatim from the branch:
https://github.com/meetajinkyaj/AI-Tools/blob/claude/points-rank-split/supabase/migrations/0014_rls_on_partners_and_invite_codes.sql

Enabling RLS with **no policies** is deliberate and is the existing convention
here — it denies `anon` and `authenticated` everything while the service role
bypasses RLS entirely. No application code path is affected: `partners` is only
ever touched server-side through the service-role client, and `invite_codes` is
never touched by application code at all, only by the triggers 0013 installed.

## Verification

**1. RLS is on, and now matches every other table.** All four rows should show
`t`.

```sql
select relname, relrowsecurity
  from pg_class
 where relname in ('partners','invite_codes','users','points_transactions')
 order by relname;
```

**2. No policies were added.** Expect zero rows — deny-all is the intent.

```sql
select tablename, policyname from pg_policies
 where tablename in ('partners','invite_codes');
```

**3. Nothing was lost.** Compare against the counts from the 0013 run
(`invite_codes` should still be 3).

```sql
select (select count(*) from invite_codes) as invite_codes,
       (select count(*) from partners)     as partners;
```

**4. Confirm no other table was left exposed** while you're in there. Expect
zero rows.

```sql
select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

If query 4 returns anything, report it — that's the same class of gap and worth
knowing about now rather than later.

## Do not

- Do not add any RLS policies. Deny-all is correct here; a permissive policy
  would reopen exactly what this closes.
- Do not modify, insert, or delete any rows.
- Do not paste any keys, tokens, or connection strings into chat.

## Report back

The output of all four queries, and confirmation that the app still works — load
the app and complete a daily check-in, which exercises the service-role path
that must keep bypassing RLS.
