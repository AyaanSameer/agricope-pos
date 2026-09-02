-- Each branch keeps its own catalogue.
--
-- The set model let one product sit on several branches at once, which made
-- "shared" mean "the same row", so a price could not differ between two shops
-- and the editor asked a question about every branch on every product. A
-- branch owning its own list is the simpler idea: one product, one branch,
-- and copying is how a list reaches a second shop — as its own rows, free to
-- diverge afterwards.
alter table products add column store_id text references stores(id) on delete cascade;

-- Collapse any set onto its first branch, in branch order, so nothing is lost
-- silently. Products sold everywhere stay unassigned; the API assigns them the
-- moment a business asks for per-branch catalogues.
update products p set store_id = (
  select ps.store_id from product_stores ps
    join stores s on s.id = ps.store_id
   where ps.product_id = p.id
   order by s.store_number
   limit 1
);

drop table product_stores;
create index products_store on products (store_id) where store_id is not null;
