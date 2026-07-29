# Cowork prompt — apply migration 0015 to production Supabase

Paste everything below the line into Claude Cowork.

---

Apply migration `0015_wearable_connections.sql` to the **production** Supabase
project for Ikigaro (`xaygldulkjjofxohescm`), using the SQL Editor.

**Ordering.** Run this BEFORE PR #69 merges. It is safe on its own — nothing
currently deployed reads the new tables, so production keeps working normally in
the gap.

## The SQL

Take the file verbatim from the branch — do not retype or reconstruct it:

https://github.com/meetajinkyaj/AI-Tools/blob/claude/cloud-wearables/supabase/migrations/0015_wearable_connections.sql

Paste the whole file into the SQL Editor and run it as one batch. It is
idempotent, so a partial run can be re-run safely.

## Expect the RLS warning NOT to appear

This migration enables Row Level Security itself, on both tables it creates.
That is deliberate — it is the convention for every table in this database, and
migration 0013 forgot it, which is why 0014 exists.

If Supabase's pre-run dialog still warns about RLS, **stop and report it**
rather than clicking through: it would mean the `alter table … enable row level
security` lines at the end of the file did not make it into what you pasted.

## Verification

Run all five. Report the output of each.

**1. Both tables exist.** Expect 2 rows.

```sql
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('wearable_connections', 'wearable_daily_metrics');
```

**2. RLS is on, with no policies.** Expect `t` for both, and zero policies.

```sql
select relname, relrowsecurity
  from pg_class
 where relname in ('wearable_connections', 'wearable_daily_metrics');

select tablename, policyname from pg_policies
 where tablename in ('wearable_connections', 'wearable_daily_metrics');
```

This is the one that matters most. Without RLS, the project's anon key could
read a table designed to hold live OAuth refresh tokens for third-party health
accounts. Deny-all is correct — the app reaches these only through the service
role, which bypasses RLS.

**3. The whole schema is still covered.** Expect zero rows.

```sql
select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

**4. The idempotency key exists.** This is what makes a re-sync overwrite a day
rather than duplicate it. Expect `wearable_daily_metrics_key`.

```sql
select indexname from pg_indexes
 where tablename = 'wearable_daily_metrics';
```

**5. Nothing else changed.** Both tables should be empty; no user data is
touched by this migration.

```sql
select (select count(*) from wearable_connections)   as connections,
       (select count(*) from wearable_daily_metrics) as metrics,
       (select count(*) from users)                  as users;
```

`users` should match what you saw on the 0013 run (3, unless people have signed
up since).

## Do not

- Do not add any RLS policies. Deny-all is intended.
- Do not insert test rows — the connect flow exercises these paths properly once
  credentials are configured.
- Do not paste any keys, tokens, or connection strings into chat. This applies
  with particular force here: the secrets this feature needs
  (`WEARABLE_TOKEN_KEY`, and six pairs of vendor client credentials) go into
  Cloudflare Worker secrets via `wrangler secret put`, never into a chat, a
  file, or the Supabase dashboard.

## Report back

The output of all five queries, and confirmation that no RLS warning appeared.
