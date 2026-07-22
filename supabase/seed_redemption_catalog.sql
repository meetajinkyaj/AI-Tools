-- Seed template for the redemption catalog. NOT a migration — run this by hand
-- (fill in real partners / codes) once partner deals are in place. Safe to run
-- repeatedly per item as long as you don't re-insert duplicate voucher codes
-- (the (item_id, code) unique index blocks accidental dupes).
--
-- Two item kinds:
--   * voucher   — costs iki points, issues a code from voucher_codes.
--   * affiliate — free click-out to affiliate_url (points_cost 0).

-- ---------------------------------------------------------------------------
-- Example 1: a VOUCHER item + its pre-loaded code pool.
-- ---------------------------------------------------------------------------
insert into redemption_items
  (name, partner, description, category, points_cost, discount_value,
   inventory_status, kind, redeem_instructions, terms)
values
  ('₹500 off your next panel', 'Nourish Labs',
   'A ₹500 credit toward a follow-up blood panel.', 'Diagnostics',
   500, '₹500 off',
   'in_stock', 'voucher',
   'Enter this code at nourishlabs.example/checkout. One use per code.',
   'Valid 90 days from issue. Minimum order ₹999. Not combinable with other offers.')
returning id;
-- Take the id printed above and load its codes (repeat the values list per code):
-- insert into voucher_codes (item_id, code) values
--   ('<ITEM_ID>', 'NOURISH-AAA-500'),
--   ('<ITEM_ID>', 'NOURISH-BBB-500'),
--   ('<ITEM_ID>', 'NOURISH-CCC-500');

-- ---------------------------------------------------------------------------
-- Example 2: an AFFILIATE product (free click-out, no points).
-- ---------------------------------------------------------------------------
insert into redemption_items
  (name, partner, description, category, points_cost,
   inventory_status, kind, affiliate_url, image_url)
values
  ('Magnesium Glycinate', 'BrandCo',
   'The magnesium we reach for — chelated, easy on the stomach.', 'Nutrition',
   0, 'in_stock', 'affiliate',
   'https://brandco.example/product/mag-glycinate?ref=ikigaro',
   null);

-- ---------------------------------------------------------------------------
-- A "coming soon" voucher (shows in the catalog but can't be redeemed yet).
-- ---------------------------------------------------------------------------
-- insert into redemption_items (name, partner, points_cost, inventory_status, kind)
-- values ('Recovery session', 'Ikigaro Space', 800, 'coming_soon', 'voucher');
