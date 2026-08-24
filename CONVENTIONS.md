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

## Open questions for the next contract sync
1. How does an order-level discount apportion across lines for per-line tax?
2. Is service charge taxable?
3. Rounding: per line or per total? (Both sides must match to the halala.)
4. Race-safe `order_number` generation (`S1-YYYYMMDD-NNNN`) under two simultaneous tills.
