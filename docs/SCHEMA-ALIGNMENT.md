> **Historical.** This reviews the earlier `pos-schema` design (39 tables) against the
> frontend. That schema was **not adopted**: the database the system runs on is
> `api/migrations/`, built to the frontend's contract, and the conflicts listed here were
> resolved by that choice. Kept because its analysis of the money model — and its ideas
> for a costing ledger and margin reporting — are the right starting point when those
> features are built.

# Schema alignment — `pos-schema` vs. the shipped frontend

Review of the eleven-migration Postgres schema (`pos-schema.zip`, 39 tables / 9 views / 3
functions) against the Phase 0–11 frontend and the API contract in `CONVENTIONS.md`.

**Verdict:** the schema is materially better thought through than the contract the frontend was
built against. It should win almost everywhere. But it is *not* a drop-in — it was designed
against Drumsticks (fast food, one outlet, aggregators) while the frontend was built against a
retail store + a restaurant. Four differences change what a customer is charged, and about a
dozen features that are already shipped in the UI have no column to land in.

Nothing here requires reshaping the schema's core. The adjustment ledger, the snapshot
discipline on order lines, and the price-list model are the right calls and the frontend should
be bent to fit them, not the other way round.

Severity key: **M** = money is wrong · **B** = shipped feature has nowhere to land · **S** =
schema defect to fix before backend code · **A** = adopt from schema.

---

## Part 1 · The four conflicts that change money

### M-01 — VAT direction is inverted between the two systems

The schema treats VAT as **inclusive and extracted**: `vat = charged × bp / (10000 + bp)`
(`0001_foundation`, `0010_reporting`). The frontend treats it as **exclusive and added**:

```
total = subtotal − discount_total + service_charge + tax_total    ← app/src/lib/totals.ts
```

Both produce identical numbers today because Qatar's VAT is 0, so nothing is failing. The day
`tenant.vat_rate_bp` is flipped to 500, the frontend charges 5% more than the schema says the
guest owes, and every contribution figure downstream is computed off a different base.

This is pinned in `app/src/lib/totals.test.ts`, which `CONVENTIONS.md` calls "the executable
spec". The spec is wrong. Fix it now while the cost is one function and seventeen tests, not
after a tenant has a year of history.

**Change:** `computeTotals` returns `total = subtotal − discount + service_charge`, with
`tax_total` reported as a memo line extracted *out of* that total. Update
`CONVENTIONS.md` § Totals and the frontend test cases together.

### M-02 — `order_line.qty` is an integer; the contract sells goods by weight

```sql
qty int not null default 1 check (qty > 0)      -- 0006_orders
```

`CONVENTIONS.md` says quantities allow three decimals for weighed goods (`"1.250"`), and
`app/src/lib/money.ts` implements `mulQty` for exactly that. The retail seed sells "Tomatoes
1kg" and "Lamb Kofta 1kg". A grocery till that cannot ring 1.25 kg is not a grocery till.

**Change (schema):** `qty numeric(12,3) not null check (qty > 0)`. Every view that multiplies
by `ol.qty` already produces `numeric`, so `v_order_line_economics` needs `round(...)` on
`gross_minor` and `cogs_minor` rather than relying on integer arithmetic. Add
`product.sold_by` (`EACH` | `WEIGHT`) and `product.unit` so the till knows to open a scale
entry instead of a quantity stepper.

### M-03 — Discounts live on the order row, not in the ledger

The frontend stores one discount per order as three columns
(`discount_type`, `discount_value`, `discount_reason` — `app/src/mocks/posdb.ts`). The schema's
whole thesis is that this is the thing you must not do: every reduction is a typed, attributed,
funded row in `price_adjustment` (`0007_adjustments`).

The frontend model cannot express: who funded it, whether the partner paid their half, which
promotion caused it, or rule one (an offer never stacks on a campaign-priced line). It also
cannot represent two discounts on one order.

**Change (frontend + contract):** `POST /orders/:id/discount` keeps its shape at the till, but
the response carries `adjustments: Adjustment[]` instead of the three columns, and the server
writes one `price_adjustment` row **per eligible line** as the schema's comment instructs.
`Order.discount_total` becomes a derived sum. The manager-PIN flow maps cleanly:
`type = 'MANAGER'`, `authorised_by` = the approving staff id, `reason_code` = the reason string
the UI already collects — the schema's `check` constraints require exactly those two fields.

### M-04 — Service charge is gated on order type, not on the channel

Frontend: `if (input.order_type === 'dine_in' && input.service_charge_rate)`.
Schema: `price_list.applies_service_charge` (`0004_pricing`) with the rate on
`outlet.service_charge_bp`.

The schema is right — a venue can want service charge on dine-in *and* own-delivery, or on
neither. The bases agree (both apply it after discount), so no money moves today, but the gate
must move to configuration.

**Change:** drop the `order_type === 'dine_in'` test; take `applies_service_charge` and
`service_charge_bp` from the order's frozen terms.

---

## Part 2 · Contract changes (`CONVENTIONS.md` + Swagger)

### A-01 — Replace `order_type` with `price_list_id` + `service_mode`

The frontend's `order_type: 'counter' | 'dine_in' | 'takeaway' | 'delivery'` conflates two
independent axes that the schema correctly separates:

| Axis | Schema | What it decides |
|---|---|---|
| `pos_order.service_mode` | `TABLE_SERVICE` \| `COUNTER` \| `DELIVERY` | Does it need a table, does it fire to a station |
| `price_list.channel` | `DINE_IN` … `AGGREGATOR`, `RETAIL`, `STAFF` | Price, commission, card fee, packaging, pay-first |

Talabat and own-delivery are both `DELIVERY` service mode and wildly different channels. The
current union cannot express that, so the whole aggregator P&L — the reason
`v_channel_pnl` exists — is unreachable from the till.

**Change:** `POST /orders` takes `price_list_id` and `service_mode`. Add `GET /price-lists`.
Keep a `channel` convenience field on the order response for the UI's existing labels.

### A-02 — Roles become data

The frontend hardcodes `type Role = 'owner' | 'manager' | 'cashier'` (`app/src/api/types.ts`)
and a single global `discount_approval_percent` in business settings. The schema has `role`
rows carrying `capabilities text[]`, `max_discount_bp`, `max_void_minor`, `can_see_cost`
(`0002_people`) — which is strictly better and already answers the Phase 7 approval threshold
per role rather than per business.

**Change:** `User.role` becomes `{ id, code, name, capabilities: string[], max_discount_bp,
max_void_minor, can_see_cost }`. Route guards and the discount-approval check read capabilities
instead of comparing role strings. This touches every `role === 'owner'` test in the app.

### A-03 — Money on the wire

Contract says decimal strings; schema says `bigint` minor units. **Keep decimal strings on the
wire** — it is unambiguous and avoids JS `bigint` serialisation — but pin the conversion:
the API converts at the boundary, exactly once, and the DB is the only place arithmetic
happens. Add to `CONVENTIONS.md`: minor unit is **dirhams**, 100 = QAR 1.00. (The doc currently
says "match to the halala" — that is the Saudi riyal's minor unit; the schema has it right.)

### A-04 — Error codes the schema implies but the registry lacks

| Code | Status | Raised when |
|---|---|---|
| `OFFER_NOT_STACKABLE` | 409 | `line_has_campaign()` is true and the promotion excludes campaign items |
| `MARGIN_FLOOR_BREACHED` | 409 | Resolved price lands under `price_list_entry.margin_floor_bp` |
| `PARTNER_REDEMPTION_DUPLICATE` | 409 | `unique (partner_program_id, external_ref)` violated |
| `CREDIT_ACCOUNT_ON_HOLD` | 403 | `credit_account.status <> 'ACTIVE'` |

---

## Part 3 · Shipped features with nowhere to land

Each of these is live in the UI today and has no column in the schema.

### B-01 — `product.barcode`

The catalog has barcode entry with duplicate validation, `GET /products?barcode=`, and a scan
listener (`app/src/lib/useBarcodeScanner.ts`). The schema has `product.sku` only. SKU and
barcode are different things and a product routinely has several barcodes (case, unit, an old
pack still on shelf — the seed even has a "Halloumi 250g (old pack)" row).

**Add:** `product_barcode (product_id, variant_id, code text, is_primary)` with
`unique (tenant_id, code)`.

### B-02 — Public receipt token

Phase 4 ships `/r/:token` e-receipts with QR and WhatsApp share. `pos_order.token_no` is the
*counter pickup number*, not this. **Add:** `pos_order.receipt_token text unique`, generated at
close, plus an expiry policy — a permanent unauthenticated URL to a customer's receipt is a
privacy question, and Qatar Law 13/2016 is already cited in `0008_customers`.

### B-03 — Cash tendered and change

`payment` has `amount_minor` and nothing else. The charge screen collects tendered and displays
change; the Z-report reconciles the drawer. **Add:** `payment.tendered_minor bigint` and
`payment.change_minor bigint` (both null for non-cash).

### B-04 — Order-level void attribution

`order_line` has `void_reason_code` / `void_by`. `pos_order` has a `VOID` status and **no
attribution at all** — no who, no why, no when. The frontend's void flow demands a manager PIN
specifically so this is recorded.

**Add:** `pos_order.voided_by`, `void_reason_code`, `voided_at`, with a check mirroring the
line-level one.

### B-05 — Refunds have no model

`payment.amount_minor` allows negatives with the comment "negative = refund", and that is the
entire refund story. There is no `REFUNDED` order status, no link from a refund back to the
payment it reverses, no reason code, no partial-refund line selection, and no restocking flag.
The frontend ships `POST /orders/:id/refund` behind a manager PIN.

**Add:** a `refund` table (`order_id`, `original_payment_id`, `amount_minor`, `reason_code`,
`authorised_by`, `restock boolean`, `shift_id`) and refund lines referencing `order_line`.
Decide whether a fully refunded order gets a status or stays `CLOSED` with a refund attached —
the reports in `0010` currently count `PAID/COLLECTED/CLOSED` and would double-count either way
until this is settled.

### B-06 — Authentication

`staff.pin_hash` exists. There is no `password_hash`, no session or refresh-token table, and no
device registration — yet `/auth/login` returns a JWT plus a refresh token, and `/auth/refresh`
rotates it.

**Add:** `staff.password_hash`, and a `refresh_token` table (`staff_id`, `token_hash`,
`issued_at`, `expires_at`, `revoked_at`, `device_label`) so a lost till can be cut off without
resetting everyone's password.

### B-07 — PIN uniqueness is not enforceable as written

The frontend rejects a duplicate till PIN. With a per-row-salted hash in `pin_hash` you cannot
index for that, so the check silently becomes "no check" against the real backend.

**Add:** `staff.pin_lookup text` — a keyed HMAC of the PIN with a server-side pepper — under
`unique (tenant_id, pin_lookup) where pin_lookup is not null`. Keep `pin_hash` (bcrypt/argon2)
as the actual verifier.

### B-08 — Kitchen tickets have no identity

The KDS calls `GET /kitchen/tickets` and `PATCH /kitchen/tickets/:id` with statuses
`new | in_progress | done | cancelled`. The schema has no ticket table — a ticket is implied by
`(order_id, station_id, batch_no)` on `order_line`, and **nothing generates `batch_no`**.
Bumping a ticket would mean updating every line in the group, and there is nowhere to record
who bumped it or when.

**Pick one, then write it down:** either add `kitchen_ticket` (with `bumped_by`, `bumped_at`,
`recalled_at`) and have lines reference it, or define `batch_no` allocation as
`max(batch_no)+1 per (order_id, station_id)` at fire time and derive ticket status as the
minimum line status. The first is better for the KDS metrics an owner will ask for next.

### B-09 — Per-line kitchen note

`order_line_modifier` covers structured options. There is no free-text note, and
`DbTicketItem.note` is already rendered on the KDS. **Add:** `order_line.note text`.

### B-10 — Stock

`product.is_stock_tracked` and `inventory_item.par_level` both exist, and there is no stock
level or stock movement table anywhere. The README flags this as deliberate, which is fine for
Drumsticks — but the retail store in the current app is precisely the case that needs it, and
`is_stock_tracked` reads as a promise the schema does not keep.

**Either** drop `is_stock_tracked` until the tables exist, **or** add
`stock_level (inventory_item_id, outlet_id, qty_on_hand)` and an append-only
`stock_movement` now. Sales already have a clean hook: `order_line` → recipe → inventory item.

### B-11 — Split and merge lineage

The frontend splits and merges orders. Moving `order_line.order_id` works, but there is no
`split_from_order_id` and no defined `order_event` types for it, so a split bill is
unreconstructable afterwards. **Add:** the column plus `ORDER_SPLIT` / `ORDER_MERGED` event
types with the moved line ids in the payload.

### B-12 — Tenant and outlet settings

`businessSettings` in the mocks holds `receipt_footer`, `business_name`, and
`discount_approval_percent`. The threshold is better handled by `role.max_discount_bp` (A-02),
but the receipt fields have no home — and a Qatar tax invoice will need legal name, CR number,
and eventually a TIN. **Add:** `tenant.legal_name`, `tenant.cr_number`, `tenant.tax_number`,
`outlet.receipt_footer`.

---

## Part 4 · Schema defects to fix before backend code

### S-01 — Order numbering is specified three different ways

`0006_orders` declares `create sequence order_no_seq` and never uses it. `pos_order.order_no`
has no default, under `unique (outlet_id, order_no)` — which a single global sequence cannot
satisfy without gaps. `CONVENTIONS.md` open question 4 wants `S1-YYYYMMDD-NNNN` per store per
day and flags the race. Three schemes, none implemented.

**Fix:** one table `order_counter (outlet_id, business_date, next_no)` updated with
`update … returning` inside the order transaction — race-safe, per-outlet, per-day, and gives
the `S{n}-{date}-{seq}` string the receipts already print. Drop the unused sequence.

### S-02 — `order_event.seq` has no generator

`unique (order_id, seq)` with no default means the application computes `max(seq)+1`, which two
concurrent tills will lose. For a table whose entire purpose is being the source of truth for
offline reconciliation, this is the wrong place to have a race.

**Fix:** assign `seq` in a `before insert` trigger holding a per-order advisory lock, or make
the unique constraint deferrable and retry. Do not leave it to callers.

### S-03 — Nothing enforces one open shift per outlet

The contract raises `SHIFT_ALREADY_OPEN` (409). The schema has no constraint, so two tills can
open two floats and the Z-report silently splits the day's cash.

**Fix:** `create unique index on shift (outlet_id) where closed_at is null;`

### S-04 — Cash payments are not tied to a shift

`payment.shift_id` is nullable with no rule. `NO_OPEN_SHIFT` is a contract error code, and the
expected-cash calculation is a sum over `payment` — a null `shift_id` on a cash row just
disappears from the drawer count.

**Fix:** `check (tender <> 'CASH' or shift_id is not null)` plus
`create index on payment (shift_id);` — currently the only index on `payment` is `(order_id)`,
so closing a shift table-scans every payment the tenant has ever taken.

### S-05 — Two sources of truth for a product's primary category

`product.primary_category_id` (FK into `product_category`) and `product_category.is_primary`
(unique partial index) can disagree, and reporting reads one while the menu screen reads the
other. The migration's own comment says sales-by-category must sum to sales; this is how it
stops doing that.

**Fix:** keep the FK column and derive `is_primary` in a view, or keep `is_primary` and drop
the column. A trigger enforcing agreement is the compromise if both are needed.

### S-06 — `tax_class` is written and never read

`product.tax_class` defaults to `'STANDARD'`, is snapshotted onto `order_line.tax_class_snapshot`,
and no view or function ever reads either. The waterfall applies `tenant.vat_rate_bp` uniformly.
Zero-rated and exempt items — which is how VAT actually arrives in the Gulf, with food
frequently zero-rated — cannot be represented.

**Fix:** `tax_rate (tenant_id, tax_class, rate_bp, effective_from)`, resolve at fire time, and
snapshot `rate_bp` (not the class name) onto the line. Then extract VAT per line and sum, rather
than applying one rate to `charged_minor`.

### S-07 — Credit ageing never ages

`v_credit_ageing` buckets on `ct.due_at`. `PAYMENT` rows have no `due_at`, so every payment
lands in `current_minor`. A customer who owes 5,000 from ninety days ago and pays 5,000 today
shows 5,000 in the 60+ bucket and −5,000 in current, forever.

**Fix:** allocate payments FIFO against oldest charges before bucketing. The frontend already
implements FIFO ageing in Phase 10 — port that logic into the view so both agree.

### S-08 — `credit_transaction` sign rules are incomplete

`CHARGE > 0` and `PAYMENT < 0` are constrained; `ADJUSTMENT` and `WRITE_OFF` are not.
A write-off entered positive increases the debt. **Fix:** `check (type <> 'WRITE_OFF' or
amount_minor < 0)`, and document that `ADJUSTMENT` is deliberately signed both ways.

### S-09 — Adjustments can exceed the bill

`price_adjustment.amount_minor > 0` is checked per row; nothing caps the sum. Over-discount an
order and `charged_minor` goes negative, which flips the VAT extraction, the commission, and the
contribution percentage all at once — silently, with no constraint violation.

**Fix:** a deferred constraint trigger asserting
`sum(adjustments) <= gross` per order at commit.

### S-10 — Unvalidated UUID arrays

`promotion.outlet_ids`, `promotion.price_list_ids`, and `stamp_program.qualifying_product_ids`
are `uuid[]` with no foreign keys. Archive an outlet and the promotion silently keeps
targeting it.

**Fix:** normalise to link tables (`promotion_outlet`, `promotion_price_list`), or accept the
denormalisation and add validation triggers. Link tables also make the "which promotions apply
here" query indexable, which the array version is not.

### S-11 — `resolve_price` ignores archival and active flags

The function reads `product.base_price_minor` without checking `archived_at` or `is_active`, and
never checks `price_list.is_active`. It will happily price a discontinued product on a disabled
channel.

Also confirm the precedence is intended: the `order by (outlet_id is not null) desc,
(variant_id is not null) desc` puts an outlet-wide *product* entry above a tenant-wide
*variant* entry. That is defensible, but it is the kind of rule that should be a comment and a
test, not an accident of clause order.

### S-12 — `cash_movement` has no `tenant_id`

RLS reaches it through a correlated subquery on `shift`, and there is no index on `shift_id`.
Both the policy and the shift report pay for it on every row. **Fix:** add `tenant_id` with a
direct policy, and `create index on cash_movement (shift_id);`

Also: `cash_movement.type` is `IN | OUT | DROP` while the frontend uses `paid_in | paid_out` and
has no drop. Map them, and add the safe-drop flow to the UI or drop the enum value.

### S-13 — Payments are not idempotent

`pos_order` carries `idempotency_key` for offline replay; `payment` does not. A retried card
capture over a flaky connection takes the money twice, and this is the single most expensive bug
class a POS has.

**Fix:** `payment.idempotency_key text` under `unique (tenant_id, idempotency_key)`, same as the
order.

### S-14 — `citext` on phone does not deduplicate phones

`customer.phone citext` with `unique (tenant_id, phone)`. Case-insensitivity is meaningless for
digits; the actual collision is `+97455512345` vs `055512345` vs `974 5551 2345`, all of which
this treats as three customers. Given phone is called "the primary identity key" in the
migration's own comment, this matters.

**Fix:** normalise to E.164 on write, store the normalised form, keep the raw input in a
separate column if the receipt needs it.

---

## Part 5 · What the schema settles

`CONVENTIONS.md` ends with four open questions. Three are now answered — write the answers in
and close them.

| Question | Answer from the schema |
|---|---|
| 1. How does an order-level discount apportion across lines for per-line tax? | It mostly doesn't: prefer **line-level** adjustments, one row per eligible line (`0007`). Genuinely order-wide reductions allocate **pro rata by line charged value** (`v_menu_engineering`). |
| 2. Is service charge taxable? | **No.** VAT is extracted from `charged_minor` only; service charge is added after and excluded from contribution (`0010`). |
| 3. Rounding — per line or per total? | **Once, at the bill.** Explicit in `0001`. The frontend currently rounds discount, service charge, and tax separately; that needs to change with M-01. |
| 4. Race-safe `order_number` under two tills? | **Still open** — see S-01. The schema does not solve it. |

---

## Part 6 · Suggested order of work

1. **Settle the four money conflicts (M-01…M-04)** and rewrite `totals.test.ts` to the new
   spec. Nothing else should start until the arithmetic is agreed on both sides.
2. **Patch the schema** with S-01…S-04 and S-13 — the correctness fixes that are cheap now and
   expensive once there is data. Ship as `0012_corrections.sql`.
3. **Confirm the price basis per item with Drumsticks** (the README's own recommendation) —
   PERMANENT vs CAMPAIGN is data, but every margin number depends on it.
4. **Contract rewrite**: A-01 through A-04 into Swagger, then `CONVENTIONS.md` to match, then
   the MSW mocks to the new shapes. The mocks are the cheapest place to find out that a shape
   does not work.
5. **Add the missing columns (B-01…B-12)** as `0013_frontend_gaps.sql`, in the order the
   frontend phases need them.
6. **Frontend refactors**: roles-as-capabilities (A-02) is the largest, touching every route
   guard; the adjustment ledger (M-03) is the second.

The parts of the schema that should not be renegotiated: the adjustment ledger, order-line
snapshots, price lists per channel, `order_event` as append-only, and RLS in the database. Those
are the reasons this is worth adopting.
