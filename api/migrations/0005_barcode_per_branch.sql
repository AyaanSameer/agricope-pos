-- A per-branch catalogue makes the same barcode legitimate twice: two shops
-- both stocking the same tin should each carry it. Uniqueness moves from
-- (business, barcode) to (business, branch, barcode).
--
-- COALESCE, because NULL never equals NULL in a unique index and "sold at
-- every branch" is exactly the row that must stay unique business-wide.
drop index products_barcode_unique;
create unique index products_barcode_unique
  on products (business_id, coalesce(store_id, ''), barcode)
  where barcode is not null;
