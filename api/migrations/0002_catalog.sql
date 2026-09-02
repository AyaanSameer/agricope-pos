-- What a business sells, and where a restaurant seats people.

create table categories (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references businesses(id) on delete cascade,
  name        text not null,
  sort_order  int not null default 0
);
create unique index categories_name_unique on categories (business_id, lower(name));

-- Where kitchen work for a product lands: the fryer, the grill, the bar.
create table kitchen_stations (
  id         text primary key default gen_random_uuid()::text,
  store_id   text not null references stores(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0
);

create table products (
  id                 text primary key default gen_random_uuid()::text,
  business_id        text not null references businesses(id) on delete cascade,
  name               text not null,
  name_ar            text,
  description        text,
  barcode            text,
  -- TAX-INCLUSIVE, always: what the customer pays
  price              numeric(12,2) not null check (price >= 0),
  -- online-channel price; null = same as in-store
  price_online       numeric(12,2) check (price_online >= 0),
  tax_rate           numeric(5,2) not null default 0,
  is_combo           boolean not null default false,
  -- {percent, starts_at, ends_at} — the in-store and online offers are independent
  offer              jsonb,
  offer_online       jsonb,
  -- [{id, name, required, choices: [{id, name, price_delta}]}]
  option_groups      jsonb not null default '[]'::jsonb,
  kitchen_station_id text references kitchen_stations(id) on delete set null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);
create unique index products_barcode_unique on products (business_id, barcode) where barcode is not null;
create index products_business_active on products (business_id, is_active);

-- A category is a placement, not ownership: a product can sit in several.
-- position 0 is the primary placement, the one reporting counts it under.
create table product_categories (
  product_id  text not null references products(id) on delete cascade,
  category_id text not null references categories(id) on delete cascade,
  position    int not null default 0,
  primary key (product_id, category_id)
);

create table dining_tables (
  id        text primary key default gen_random_uuid()::text,
  store_id  text not null references stores(id) on delete cascade,
  name      text not null,
  zone      text not null default 'Main hall',
  seats     int not null check (seats > 0),
  is_active boolean not null default true
);
create unique index dining_tables_name_unique on dining_tables (store_id, lower(name));
