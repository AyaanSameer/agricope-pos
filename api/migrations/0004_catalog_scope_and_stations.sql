-- Two choices the owner should be making, not us.

-- 1 · Does one catalogue serve every branch, or does each branch keep its own?
--     Shared is the default and what every existing tenant has been running.
alter table businesses add column shared_catalog boolean not null default true;

-- A product's home branch. NULL = sold at every branch, which is what every
-- existing row means and what a shared catalogue always means. Only consulted
-- when the business has turned sharing off.
--
-- CASCADE is safe: a branch can only be deleted when it never took an order,
-- so nothing it sold can be orphaned — and order lines snapshot the product
-- name anyway, so history survives a product disappearing.
alter table products add column store_id text references stores(id) on delete cascade;
create index products_store on products (store_id) where store_id is not null;

-- 2 · Kitchen stations become the owner's to name, add and retire, so a branch
--     can route to "Fry", "Grill" and "Bar" or to nothing at all. Two stations
--     on one branch may not share a name — the till picks by it.
create unique index kitchen_stations_name_unique on kitchen_stations (store_id, lower(name));
