-- Money changing hands: orders, payments, credit, the cash drawer, the kitchen.

create table customers (
  id           text primary key default gen_random_uuid()::text,
  business_id  text not null references businesses(id) on delete cascade,
  name         text not null,
  phone        text,
  email        text,
  -- null = no credit facility; setting one needs a manager PIN
  credit_limit numeric(12,2) check (credit_limit >= 0),
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index customers_business on customers (business_id, is_active);

-- The cash drawer. Exactly one open shift per branch, enforced here.
create table shifts (
  id             text primary key default gen_random_uuid()::text,
  store_id       text not null references stores(id) on delete cascade,
  status         text not null check (status in ('open', 'closed')),
  opened_by      text references users(id) on delete set null,
  opened_by_name text not null,
  closed_by      text references users(id) on delete set null,
  closed_by_name text,
  opening_float  numeric(12,2) not null check (opening_float >= 0),
  -- the server computes expected_cash at close; the client only ever counts
  expected_cash  numeric(12,2),
  counted_cash   numeric(12,2),
  over_short     numeric(12,2),
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz
);
create unique index shifts_one_open_per_store on shifts (store_id) where status = 'open';
create index shifts_store_opened on shifts (store_id, opened_at desc);

create table cash_movements (
  id              text primary key default gen_random_uuid()::text,
  shift_id        text not null references shifts(id) on delete cascade,
  type            text not null check (type in ('paid_in', 'paid_out')),
  amount          numeric(12,2) not null check (amount > 0),
  reason          text not null,
  created_by      text references users(id) on delete set null,
  created_by_name text not null,
  created_at      timestamptz not null default now()
);

-- Race-safe order numbers: one counter per branch per day, bumped inside the
-- order's own transaction. Two tills cannot mint the same number.
create table order_sequences (
  store_id text not null references stores(id) on delete cascade,
  day      date not null,
  last     int not null default 0,
  primary key (store_id, day)
);

create table orders (
  id                   text primary key default gen_random_uuid()::text,
  -- RESTRICT: a branch that has sold anything keeps its history. The API
  -- clears orders deliberately, in order, when a whole business is deleted.
  store_id             text not null references stores(id) on delete restrict,
  order_number         text not null,
  cashier_id           text references users(id) on delete set null,
  cashier_name         text not null,
  customer_id          text references customers(id) on delete set null,
  status               text not null check (status in ('open', 'completed', 'void', 'refunded')),
  order_type           text not null check (order_type in ('counter', 'dine_in', 'takeaway', 'delivery')),
  table_id             text references dining_tables(id) on delete set null,
  guest_count          int,
  discount_type        text check (discount_type in ('percent', 'fixed')),
  discount_value       numeric(12,2),
  discount_reason      text,
  discount_approved_by text references users(id) on delete set null,
  subtotal             numeric(12,2) not null default 0,
  discount_total       numeric(12,2) not null default 0,
  service_charge_total numeric(12,2) not null default 0,
  tax_total            numeric(12,2) not null default 0,
  total                numeric(12,2) not null default 0,
  note                 text,
  -- the public e-receipt link; unguessable
  receipt_token        text not null unique default gen_random_uuid()::text,
  shift_id             text references shifts(id) on delete set null,
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  unique (store_id, order_number)
);
create index orders_store_status on orders (store_id, status, created_at desc);
create index orders_created on orders (created_at desc);
create index orders_shift on orders (shift_id) where shift_id is not null;
-- Open tabs by table. One tab per table is the API's rule (a split bill
-- legitimately puts two open orders on one table), so this is a lookup index.
create index orders_open_by_table on orders (table_id) where status = 'open' and table_id is not null;

-- Lines are snapshots: name, price and tax as they were at the sale. A rename
-- or a price change tomorrow never touches yesterday's receipt.
create table order_items (
  id                 text primary key default gen_random_uuid()::text,
  order_id           text not null references orders(id) on delete cascade,
  product_id         text references products(id) on delete set null,
  product_name       text not null,
  -- selected option labels, e.g. ["Spicy"]
  options            jsonb not null default '[]'::jsonb,
  unit_price         numeric(12,2) not null,
  quantity           numeric(12,3) not null check (quantity > 0),
  discount           numeric(12,2) not null default 0,
  tax_rate           numeric(5,2) not null default 0,
  line_total         numeric(12,2) not null default 0,
  sent_to_kitchen_at timestamptz,
  position           int not null default 0
);
create index order_items_order on order_items (order_id, position);

-- A refund is a negative payment row against the same order.
create table payments (
  id               text primary key default gen_random_uuid()::text,
  order_id         text not null references orders(id) on delete cascade,
  method           text not null check (method in ('cash', 'card', 'online', 'credit')),
  amount           numeric(12,2) not null,
  tendered         numeric(12,2),
  change_given     numeric(12,2),
  reference        text,
  received_by      text references users(id) on delete set null,
  received_by_name text not null,
  created_at       timestamptz not null default now()
);
create index payments_order on payments (order_id, created_at);

-- The credit ledger: charges are positive, repayments negative. A customer's
-- balance is the sum, always computed, never stored.
create table credit_ledger (
  id              text primary key default gen_random_uuid()::text,
  customer_id     text not null references customers(id) on delete cascade,
  entry_type      text not null check (entry_type in ('charge', 'repayment', 'adjustment')),
  amount          numeric(12,2) not null,
  order_id        text references orders(id) on delete set null,
  method          text check (method in ('cash', 'card', 'online')),
  note            text,
  created_by      text references users(id) on delete set null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  shift_id        text references shifts(id) on delete set null
);
create index credit_ledger_customer on credit_ledger (customer_id, created_at);
create index credit_ledger_shift on credit_ledger (shift_id) where shift_id is not null;

create table kitchen_tickets (
  id           text primary key default gen_random_uuid()::text,
  order_id     text not null references orders(id) on delete cascade,
  order_number text not null,
  table_name   text,
  station_id   text not null references kitchen_stations(id) on delete cascade,
  status       text not null check (status in ('new', 'in_progress', 'done', 'cancelled')),
  created_at   timestamptz not null default now(),
  done_at      timestamptz
);
create index kitchen_tickets_station on kitchen_tickets (station_id, status, created_at);

create table kitchen_ticket_items (
  id            text primary key default gen_random_uuid()::text,
  ticket_id     text not null references kitchen_tickets(id) on delete cascade,
  -- set null when the line is pulled — the ticket keeps showing it, struck out
  order_item_id text references order_items(id) on delete set null,
  product_name  text not null,
  description   text,
  quantity      numeric(12,3) not null,
  note          text,
  cancelled     boolean not null default false
);
create index kitchen_ticket_items_ticket on kitchen_ticket_items (ticket_id);
