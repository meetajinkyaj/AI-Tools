-- 0011: Deletable catalog items — history survives, the item doesn't have to.
--
-- Admins need to hard-delete test/stale vouchers so launch starts from a clean
-- catalog, but a user's redemption history must keep its records (they spent
-- points; the code is theirs). So:
--   1. Snapshot the item's name onto redemption_transactions at redemption time
--      (item_name), and backfill existing rows from the join.
--   2. Relax the FK from ON DELETE RESTRICT to ON DELETE SET NULL (item_id
--      becomes nullable) — deleting an item orphans the history row gracefully
--      instead of blocking the delete. voucher_codes already cascade.
--   3. redeem_voucher() writes the snapshot on every new redemption.
--
-- Idempotent.

alter table redemption_transactions
  add column if not exists item_name text;

update redemption_transactions rt
   set item_name = ri.name
  from redemption_items ri
 where rt.item_name is null
   and rt.item_id = ri.id;

alter table redemption_transactions
  alter column item_id drop not null;

alter table redemption_transactions
  drop constraint if exists redemption_transactions_item_id_fkey;
alter table redemption_transactions
  add constraint redemption_transactions_item_id_fkey
  foreign key (item_id) references redemption_items(id) on delete set null;

-- Same function as 0008, plus the item_name snapshot on insert.
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
  select * into v_item from redemption_items where id = p_item_id for update;
  if not found then raise exception 'item_not_found'; end if;
  if v_item.kind <> 'voucher' then raise exception 'not_a_voucher'; end if;
  if v_item.inventory_status <> 'in_stock' then raise exception 'not_available'; end if;

  select points_balance into v_balance
    from reward_points where profile_id = p_profile_id for update;
  if v_balance is null then raise exception 'no_balance'; end if;
  if v_balance < v_item.points_cost then raise exception 'insufficient_points'; end if;

  select id, vc.code into v_code_id, v_code
    from voucher_codes vc
   where vc.item_id = p_item_id and vc.status = 'available'
   order by vc.created_at
   for update skip locked
   limit 1;
  if v_code_id is null then raise exception 'out_of_stock'; end if;

  update reward_points
     set points_balance = points_balance - v_item.points_cost
   where profile_id = p_profile_id;

  insert into points_transactions (user_id, profile_id, type, amount, reason, reference_id)
  values (p_user_id, p_profile_id, 'redeem', v_item.points_cost, 'redemption', p_item_id);

  insert into redemption_transactions
    (user_id, profile_id, item_id, item_name, points_spent, status, discount_code, redeemed_at)
  values
    (p_user_id, p_profile_id, p_item_id, v_item.name, v_item.points_cost, 'fulfilled', v_code, now())
  returning id into v_redemption_id;

  update voucher_codes
     set status = 'assigned', redemption_id = v_redemption_id, assigned_at = now()
   where id = v_code_id;

  return query
    select v_code, v_item.redeem_instructions, v_balance - v_item.points_cost;
end;
$$;
