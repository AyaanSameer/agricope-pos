# Agricope POS — API contract conventions (Phase 0)

Agreed frontend ↔ backend ground rules. **The Swagger spec is the referee** — this file mirrors
its conventions block; if they disagree, fix Swagger first, then this file. Contract changes go
through Swagger PRs, never just chat.

## Transport
- Base path `/api/v1`, JSON everywhere, dates in ISO-8601 UTC.
- Auth: `POST /auth/login` → short-lived JWT (carries `user_id`, `business_id`, `role`) + refresh
  token. Every other call sends `Authorization: Bearer <token>`.
- `business_id` comes **only** from the token, never from the client.

## Money
- Money is sent as **decimal strings** (`"60.00"`), never JSON numbers.
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
line_total     = unit_price × quantity − line discount
subtotal       = Σ line_total
discount_total = order discount applied to subtotal
service_charge = service_charge_rate × (subtotal − discount_total)   [dine-in only]
tax_total      = Σ per-line tax on discounted amounts
total          = subtotal − discount_total + service_charge + tax_total
```
The server recomputes every total from database prices; client-sent totals are ignored.

## Endpoints implemented in MSW (mirror = her Swagger checklist)
Auth: login · refresh · switch-cashier — Org: stores · users CRUD — Catalog:
categories · products (+`?barcode=`/`?search=`) · kitchen/stations — Orders:
create (full or empty) · list · get · patch (customer) · payments · discount
(+approval) · void · refund · items add/edit/remove · split · merge · send —
Receipts: `/orders/:id/receipt` · public `/r/:token` — Customers: CRUD ·
statement · repayments · balances — Shifts: open · current · movements ·
close · report · list — Tables: `/tables/floor` — Kitchen: tickets list ·
ticket status — Reports: summary · top-items · credit-aging.

The frontend's `computeTotals` unit tests (`app/src/lib/totals.test.ts`) are
the executable spec for the totals formula — copy the cases into the
backend's suite so both sides round identically.

## Open questions for the next contract sync
1. How does an order-level discount apportion across lines for per-line tax?
2. Is service charge taxable?
3. Rounding: per line or per total? (Both sides must match to the halala.)
4. Race-safe `order_number` generation (`S1-YYYYMMDD-NNNN`) under two simultaneous tills.
