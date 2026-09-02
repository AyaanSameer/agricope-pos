-- The platform and the people on it.
--
-- Conventions, once: ids are text (readable in seeds, uuid at runtime),
-- money is numeric(12,2) and comes back to the API as a decimal string,
-- quantities are numeric(12,3) for weighed goods, rates are percent
-- numeric(5,2), and every row that a person wrote carries their name as a
-- snapshot beside the foreign key — receipts and reports keep saying who
-- rang them up after that login is deactivated or deleted.

create table platform_admins (
  id            text primary key default gen_random_uuid()::text,
  name          text not null,
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- A business is a tenant: one login for every branch it runs.
create table businesses (
  id                        text primary key default gen_random_uuid()::text,
  name                      text not null,
  email                     text not null unique,
  password_hash             text not null,
  -- Suspended: nobody can sign in. Deletion is only offered from here.
  is_active                 boolean not null default true,
  receipt_footer            text not null default '',
  -- order discounts above this percent ask for a manager PIN at the till
  discount_approval_percent numeric(5,2) not null default 10,
  created_at                timestamptz not null default now()
);

create table stores (
  id                  text primary key default gen_random_uuid()::text,
  business_id         text not null references businesses(id) on delete cascade,
  -- S1, S2… within the business; every order number carries it
  store_number        int not null,
  name                text not null,
  type                text not null check (type in ('retail', 'restaurant')),
  address             text,
  phone               text,
  is_active           boolean not null default true,
  kitchen_mode        text not null default 'kds' check (kitchen_mode in ('kds', 'printer')),
  -- dine-in service charge, percent; retail branches carry 0
  service_charge_rate numeric(5,2) not null default 0,
  created_at          timestamptz not null default now(),
  unique (business_id, store_number)
);

-- Till logins. The PIN identifies the person; its HMAC is what is stored.
create table users (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references businesses(id) on delete cascade,
  -- null = works across every branch (owners)
  store_id    text references stores(id) on delete set null,
  name        text not null,
  email       text not null,
  role        text not null check (role in ('owner', 'manager', 'cashier', 'waiter')),
  pin_hash    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, email)
);
-- A PIN is unique within a business — the lookup on the till depends on it.
create unique index users_pin_unique on users (business_id, pin_hash) where pin_hash is not null;

-- The workforce: attendance, not logins. A fry cook who never touches the till.
create table staff_members (
  id          text primary key default gen_random_uuid()::text,
  business_id text not null references businesses(id) on delete cascade,
  store_id    text references stores(id) on delete set null,
  name        text not null,
  role_title  text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table attendance (
  id          text primary key default gen_random_uuid()::text,
  staff_id    text not null references staff_members(id) on delete cascade,
  check_in    timestamptz not null default now(),
  check_out   timestamptz,
  recorded_by text references users(id) on delete set null
);
create index attendance_staff on attendance (staff_id, check_in desc);
