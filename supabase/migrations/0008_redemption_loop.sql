-- 0008: Redemption loop — vouchers (points → code) and affiliate products.
--
-- Builds on the redemption_items / redemption_transactions tables from 0002:
--   1. redemption_items grows a `kind` (voucher | affiliate) plus presentation
--      fields (image, terms, how-to) and an affiliate_url for click-out items.
--   2. voucher_codes: a pre-loaded pool of codes per item; redemption assigns
--      the next available one.
--   3. redeem_voucher(): an ATOMIC redeem — check balance, pop a code, deduct
--      points, write the ledger + redemption rows — all in one transaction with
--      row locks, so points can't be double-spent and a code can't be issued
--      twice under concurrency.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. redemption_items: kind + presentation + affiliate link.
-- ---------------------------------------------------------------------------
alter table redemption_items
  add column if not exists kind                text not null default 'voucher',
  add column if not exists affiliate_url       text,
  add column if not exists image_url           text,
  add column if not exists redeem_instructions text,
  add column if not exists terms               text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'redemption_items_kind_check'
  ) then
    alter table redemption_items
      add constraint redemption_items_kind_check check (kind in ('voucher', 'affiliate'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. voucher_codes — the pre-loaded code pool.
-- ---------------------------------------------------------------------------
create table if not exists voucher_codes (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references redemption_items(id) on delete cascade,
  code          text not null,
  status        text not null default 'available', -- 'available' | 'assigned'
  redemption_id uuid references redemption_transactions(id) on delete set null,
  assigned_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint voucher_codes_status_check check (status in ('available', 'assigned'))
);

-- No duplicate code within an item; fast "next available" lookups.
create unique index if not exists voucher_codes_item_code_key
  on voucher_codes (item_id, code);
create index if not exists voucher_codes_available_idx
  on voucher_codes (item_id, status);

-- ---------------------------------------------------------------------------
-- 3. redeem_voucher() — atomic points-for-code redemption.
--    Raises a coded exception the API maps to a friendly message:
--      item_not_found | not_a_voucher | not_available | no_balance |
--      insufficient_points | out_of_stock
-- ---------------------------------------------------------------------------
create or replace function redeem_voucher(
  p_user_id    uuid,
  p_profile_id uuid,
  p_item_id    uuid
)
returns table (code text, redeem_instructions text, new_balance integer)
language plpgsql
as $$
declare
  v_item          redemption_items;
  v_balance       integer;
  v_code_id       uuid;
  v_code          text;
  v_redemption_id uuid;
begin
  -- Lock the catalog item.
  select * into v_item from redemption_items where id = p_item_id for update;
  if not found then raise exception 'item_not_found'; end if;
  if v_item.kind <> 'voucher' then raise exception 'not_a_voucher'; end if;
  if v_item.inventory_status <> 'in_stock' then raise exception 'not_available'; end if;

  -- Lock the balance row and check funds.
  select points_balance into v_balance
    from reward_points where profile_id = p_profile_id for update;
  if v_balance is null then raise exception 'no_balance'; end if;
  if v_balance < v_item.points_cost then raise exception 'insufficient_points'; end if;

  -- Claim the next available code (SKIP LOCKED avoids two redeemers grabbing one).
  select id, vc.code into v_code_id, v_code
    from voucher_codes vc
   where vc.item_id = p_item_id and vc.status = 'available'
   order by vc.created_at
   for update skip locked
   limit 1;
  if v_code_id is null then raise exception 'out_of_stock'; end if;

  -- Deduct points (reward_points has a >= 0 check as a backstop).
  update reward_points
     set points_balance = points_balance - v_item.points_cost
   where profile_id = p_profile_id;

  -- Ledger entry.
  insert into points_transactions (user_id, profile_id, type, amount, reason, reference_id)
  values (p_user_id, p_profile_id, 'redeem', v_item.points_cost, 'redemption', p_item_id);

  -- Redemption record (fulfilled — the code is issued immediately).
  insert into redemption_transactions
    (user_id, profile_id, item_id, points_spent, status, discount_code, redeemed_at)
  values
    (p_user_id, p_profile_id, p_item_id, v_item.points_cost, 'fulfilled', v_code, now())
  returning id into v_redemption_id;

  -- Mark the code assigned.
  update voucher_codes
     set status = 'assigned', redemption_id = v_redemption_id, assigned_at = now()
   where id = v_code_id;

  return query
    select v_code, v_item.redeem_instructions, v_balance - v_item.points_cost;
end;
$$;
