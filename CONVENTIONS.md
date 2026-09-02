# Agricope POS — API contract conventions (Phase 0)

Agreed frontend ↔ backend ground rules. **The Swagger spec is the referee** — this file mirrors
its conventions block; if they disagree, fix Swagger first, then this file. Contract changes go
through Swagger PRs, never just chat.

## Transport
- Base path `/api/v1`, JSON everywhere, dates in ISO-8601 UTC.
- Auth is TWO-STAGE (Phase 12): a business has ONE login for all branches.
  `POST /auth/login` (business email + password) → `{ business_token, business, stores }`.
  `POST /auth/switch-cashier` (`store_id` | null, `pin`) with that token identifies the PERSON
  → short-lived JWT (carries `user_id`, `business_id`, `role`) + refresh token. The same
  endpoint also hands the till over mid-shift. `store_id: null` = back office; only
  cross-store PINs (owner) match there.
- Every other call sends `Authorization: Bearer <token>` (user JWT).
- `business_id` comes **only** from the token, never from the client. Everything —
  users, PINs, staff, catalog, orders, customers, shifts — is scoped to it; RLS in the DB.

## Money
- Money is sent as **decimal strings** (`"60.00"`), never JSON numbers.
- **Prices are TAX-INCLUSIVE** (Gulf convention). Tax is extracted as a memo
  line — `taxable × rate / (100 + rate)` — and never added on top.
- Frontend rule: all money arithmetic goes through `app/src/lib/money.ts` (big.js).
  `parseFloat` on money is a review-blocking bug.
- Quantities allow 3 decimals for weighed goods (`"1.250"`).

## Errors — one shape for everything
```json
{ "error": { "code": "CREDIT_LIMIT_EXCEEDED", "message": "Human-readable explanation." } }
```

### Error code registry (grows as phases land — keep in Swagger too)
| Code | Status | Introduced |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Phase 0 |
| `UNAUTHENTICATED` | 401 | Phase 1 (missing/expired token) |
| `INVALID_PIN` | 401 | Phase 1 (switch-cashier) |
| `INVALID_TOKEN` | 401 | Phase 1 (refresh) |
| `FORBIDDEN` | 403 | Phase 1 (role guard) |
| `VALIDATION_ERROR` | 400 | Phase 1 |
| `NOT_FOUND` | 404 | Phase 1 |
| `CUSTOMER_REQUIRED` | 400 | Phase 5 (credit without a customer) |
| `APPROVAL_REQUIRED` (credit limit) | 403 | Phase 15 — `POST /customers` with a limit, and `PATCH /customers/:id` changing `credit_limit`, both need `X-Approval-Pin` |
| `CREDIT_LIMIT_EXCEEDED` | 403 | Phase 5 |
| `NO_OPEN_SHIFT` | 409 | Phase 6 (cash sales, refunds & repayments) |
| `SHIFT_ALREADY_OPEN` | 409 | Phase 6 (one open shift per store) |
| `SHIFT_CLOSED` | 409 | Phase 6 |
| `APPROVAL_REQUIRED` | 403 | Phase 7 (discount/void/refund/pull — retry with `X-Approval-Pin`) |
| `PAYMENTS_STARTED` | 409 | Phase 7 (discount after payments) |
| `ORDER_NOT_OPEN` / `ORDER_NOT_COMPLETED` | 409 | Phase 3 |
| `TABLE_OCCUPIED` | 409 | Phase 8 |
| `ITEM_ALREADY_SENT` | 409 | Phase 8 (edit a fired line) |
| `NOTHING_TO_SEND` | 409 | Phase 9 |
| `ALREADY_CHECKED_IN` / `NOT_CHECKED_IN` | 409 | Phase 12 (staff attendance) |
| `APPROVAL_REQUIRED` | 403 | Phase 7 (discounts; retried with `X-Approval-Pin`) |
| `CREDIT_LIMIT_EXCEEDED` | 403 | Phase 5 |
| `NO_OPEN_SHIFT` | 409 | Phase 6 (cash payments & cash repayments) |

## Pagination
Lists take `?page=1&limit=50` and return `{ "data": [...], "total": n, "page": n, "limit": n }`.

## Login exchange (implemented in MSW, to mirror in Swagger)
```jsonc
// POST /api/v1/auth/login
{ "email": "sara@alrayyan-market.qa", "password": "…" }
// → 200
{
  "access_token": "…", "refresh_token": "…",
  "user": {
    "id": "…", "name": "Sara Al-Ali", "email": "…",
    "role": "cashier",                  // owner | manager | cashier
    "business_id": "…",
    "store_id": "…", "store_name": "…"  // null when user works across all stores
  }
}
// → 401 { "error": { "code": "INVALID_CREDENTIALS", "message": "…" } }
```

## Cashier switch (Phase 1, implemented in MSW, to mirror in Swagger)
```jsonc
// POST /api/v1/auth/switch-cashier   (requires a valid session — the till is already signed in)
{ "store_id": "…", "pin": "1234" }
// → 200 same shape as /auth/login (the till keeps its store; the person changes)
// → 401 { "error": { "code": "INVALID_PIN", … } }
```
PINs are write-only: `GET /users` returns `has_pin`, never the PIN itself.
Users CRUD (`GET/POST /users`, `PATCH /users/:id`) is owner/manager only → `403 FORBIDDEN`.

## Totals — the one agreed order of operations (both sides compute identically)
```
line_total     = unit_price × quantity − line discount        [prices incl. tax]
subtotal       = Σ line_total
discount_total = order discount applied to subtotal
service_charge = service_charge_rate × (subtotal − discount_total)   [dine-in only]
total          = subtotal − discount_total + service_charge
tax_total      = Σ per-line  taxable × rate / (100 + rate)    [memo — already inside total]
```
The server recomputes every total from database prices; client-sent totals are ignored.
Unit prices resolve server-side per channel: online orders use `price_online` (fallback:
`price`), a live product offer (percent, optional end date) applies next, then selected
option deltas. `lib/pricing.ts` is the shared implementation, like `lib/totals.ts`.

## Endpoints implemented in MSW (mirror = her Swagger checklist)
Auth: business login · refresh · switch-cashier (PIN → person) — Org: stores ·
`PATCH /stores/:id` (kitchen_mode: kds | printer) · users CRUD + owner-only
`DELETE /users/:id` — Staff: list · create · patch · check-in · check-out — Admin (platform):
businesses list · create · add branch · create owner — Tables (owner only):
`POST /tables` · `PATCH /tables/:id` · `DELETE /tables/:id` (409 TABLE_OCCUPIED on
an open tab); `PATCH /orders/:id` also takes `table_id` — a dine-in order may start
WITHOUT a table and be assigned one later (optional) — Catalog:
categories · products (+`?barcode=`/`?search=`) · kitchen/stations — Orders:
create (full or empty) · list · get · patch (customer) · payments · discount
(+approval) · void · refund · items add/edit/remove · split · merge · send —
Receipts: `/orders/:id/receipt` · public `/r/:token` — Customers: CRUD ·
statement · repayments · balances — Shifts: open · current · movements ·
close · report · list — Tables: `/tables/floor` — Kitchen: tickets list ·
ticket status — Reports: summary · top-items · credit-aging.

## Roles (Phase 15 — `waiter` is new, mirror in Swagger)
`owner | manager | cashier | waiter`. A waiter works the floor and nothing else:
Tables, Register, Orders and Kitchen — no Customers, no Shifts (they never hold the
drawer) and no back office. Demo PINs stay one digit per role: 1111 owner ·
2222 manager · 3333 cashier · 4444 waiter. Only the owner may delete a login or
manage tables; Users and Settings are owner + manager.

## Reports windows (Phase 14 — new, mirror in Swagger)
`GET /reports/summary` and `GET /reports/top-items` take `?range=today|7d|month`
(default `today`), alongside the existing `?store_id=`. A window runs from midnight
`range`-days-back to *now*, and `summary` additionally returns a `previous` block —
`{ gross_sales, order_count, average_order, discount_total }` for the same-length
window immediately before it (same hours elapsed, so "vs yesterday" compares like
with like). The Reports screen renders the movement between the two; when `previous`
is absent, or its figure is zero, the UI shows "no comparison" rather than a bogus
percentage. Credit-ageing buckets stay `current | 30 | 60 | 90+` (days since the
oldest unpaid charge, FIFO) — only `90+` is coloured as genuinely overdue.

The frontend's `computeTotals` unit tests (`app/src/lib/totals.test.ts`) are
the executable spec for the totals formula — copy the cases into the
backend's suite so both sides round identically.

## Product shape (Phase 12)
A product carries: `name`, `name_ar`, `description`, `category_ids[]` (first = primary,
reporting), `barcode`, `price` (in-store, incl. tax), `price_online` (null = same),
`tax_rate`, `is_combo`, `offer` (`{ percent, starts_at, ends_at }`, null = none),
`option_groups[]` (`{ name, required, choices: [{ name, price_delta }] }` — e.g.
Flavor: Normal/Spicy/Mix), `kitchen_station_id`, `is_active`. Order items snapshot the
resolved unit price and the chosen option labels; `option_ids` go up, labels come back.

## Phase 15 contract changes
- **Products carry two independent discounts.** `offer` is the in-store discount;
  `offer_online` is the online one. Each has its own `{percent, starts_at, ends_at}`
  window. A channel with no offer object runs no discount — an in-store promo never
  leaks online. `resolveUnitPrice(product, channel)` is still the only place a sell
  price is computed.
- **Credit limits are approval-gated.** Setting or changing `customers.credit_limit`
  requires `X-Approval-Pin` belonging to an active manager/owner of the same business;
  without it the API answers `403 APPROVAL_REQUIRED`. Contact edits (name, phone,
  email, notes) stay unrestricted — customers are CRM records first.
- **Orders expose the attached customer's credit standing** so the charge screen can
  decide whether credit is offerable without a second call: `customer_credit_limit`
  (null = no facility) and `customer_balance`.
- `order_type` still accepts `counter` for historical rows, but the register no longer
  offers it — new orders are `dine_in`, `takeaway` or `delivery`.

## Going commercial (2026-08-30)

- **Business credentials are managed at two levels.**
  `PATCH /admin/businesses/:id { email?, password? }` — platform admin changes a
  business's sign-in (email must stay unique across businesses and admins; password
  min 8 chars). `POST /auth/change-password { current_password, new_password }` —
  the OWNER changes the business password from Settings; the server re-checks the
  current password and the owner role (204 on success). Both take effect at the
  next sign-in; existing sessions stay valid.
- **Kitchen tickets snapshot the product description.** Ticket items carry
  `description: string | null`, copied from the product at fire time — the KDS and
  the printed 80mm ticket show what is in the box even if the catalog is edited
  later. Order lines themselves are unchanged.
- **No demo affordances in the UI.** Seeded credentials live only in the mock world
  and are documented in the README; the login screen shows none.

## Lifecycle: deactivate first, delete second (2026-09-02)

Every removable thing has a reversible off-switch and an irreversible delete,
and the delete is refused until the off-switch has been used:

| Thing | Off | Delete | Who |
|---|---|---|---|
| Business | `PATCH /admin/businesses/:id {is_active:false}` — nobody can sign in (`403 BUSINESS_SUSPENDED` at login; issued tokens stop working) | `DELETE /admin/businesses/:id` — erases the tenant and every order under it | platform admin |
| Branch | `PATCH /admin/businesses/:id/stores/:sid {is_active:false}` — vanishes from the till's branch picker | `DELETE …/stores/:sid` — **refused with `409 HAS_HISTORY` if the branch ever took an order**; it stays deactivated so the history survives | platform admin |
| Login | `PATCH /users/:id {is_active:false}` | `DELETE /users/:id` — not yourself | owner (managers may deactivate) |
| Staff | `PATCH /staff/:id {is_active:false}` | `DELETE /staff/:id` — attendance goes with them | owner (managers may deactivate) |

Deleting while still active answers `409 STILL_ACTIVE`. Names are snapshotted on
orders, payments, ledger entries and shifts, so deleting a login never blanks a
receipt or a report.

`POST /admin/change-password {current_password, new_password}` — the platform
administrator's own password (min 8 chars, current re-checked).

## Open questions for the next contract sync
1. How does an order-level discount apportion across lines for per-line tax?
2. Is service charge taxable?
3. Rounding: per line or per total? (Both sides must match to the dirham.)
4. Race-safe `order_number` generation (`S1-YYYYMMDD-NNNN`) under two simultaneous tills.
