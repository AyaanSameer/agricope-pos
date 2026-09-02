-- A product belongs to a SET of branches, not one.
--
-- The single `products.store_id` could say "this branch" or "all branches" and
-- nothing in between, so two shops sharing a list while a third differs meant
-- duplicating every shared product — two rows to reprice, two to put on offer.
-- A join table says it once: these branches sell it.
--
-- No rows at all = every branch. That is what `store_id is null` meant, it is
-- the right default for a new product, and it keeps a business that never
-- thinks about branches from having to.
create table product_stores (
  product_id text not null references products(id) on delete cascade,
  store_id   text not null references stores(id) on delete cascade,
  primary key (product_id, store_id)
);
create index product_stores_store on product_stores (store_id);

insert into product_stores (product_id, store_id)
  select id, store_id from products where store_id is not null;

-- Barcode uniqueness cannot be an index any more: the rule is "no two products
-- that could both appear at one branch share a barcode", which is set overlap,
-- not column equality. The API enforces it inside the write transaction; this
-- index is for the scanner's lookup.
drop index products_barcode_unique;
create index products_barcode on products (business_id, barcode) where barcode is not null;

alter table products drop column store_id;
