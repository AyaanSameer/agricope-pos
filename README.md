# Agricope POS — frontend

Multi-tenant point of sale for shops and restaurants. React SPA per till; talks only to the
Node.js REST API (separate repo). See `agricope-pos-system-design.md` in `mockups/` for the full
system design, and `CONVENTIONS.md` for the API contract ground rules.

## Repo layout
- `app/` — the React application (Vite + TypeScript)
- `mockups/` — static HTML design mockups (reference only)

## Run it
```bash
cd app
npm install
npm run dev
```
The app runs against **MSW mocks** by default (no backend needed).
Demo logins (password `demo123`):
- `sara@alrayyan-market.qa` — cashier, Al Rayyan Store (till PIN 1234; Amal 2345)
- `yusuf@karakcorner.qa` — cashier, Karak Corner restaurant (till PIN 3456)
- `maryam@alrayyan-market.qa` — manager, Al Rayyan Store (PIN 9999)
- `owner@agricope.qa` — owner, all stores (PIN 0000)

To point at the real API set `VITE_USE_MOCKS=false` in `app/.env.local`.

## Stack
React 19 · Vite · TypeScript · TanStack Query · React Router · MSW · big.js (money — never floats)

## Phase status (see frontend-workflow doc)
- [x] Phase 0 — foundations & contract: auth against mock, routing, brand theming, `money.ts`, conventions written down
- [x] Phase 1 — auth & org: PIN cashier switch, owner store picker, users admin (owner/manager), role-guarded routes
- [x] Phase 2 — catalog: categories & products admin (CRUD, soft-delete, barcode, kitchen-station field), live register grid
- [ ] Phase 3 — register & payments ★ (cart, charge, split payments) · …


## Testing

### Automated
```bash
cd app
npm test            # unit tests — money math (big.js): split payments, weighed goods, rounding
npm run typecheck   # strict TypeScript across the app
```

### Manual walkthrough (runs fully on mocks — no backend needed)
Start `npm run dev`, open http://localhost:5173, then:

**As a cashier (Sara)** — `sara@alrayyan-market.qa` / `demo123`
1. You land straight on *Register — Al Rayyan Store*; nav shows only Register · Orders · Customers · Shifts.
2. Browse the product grid: category tabs, search box filters live.
3. *Switch cashier · PIN* → wrong PIN is rejected → `2345` hands the till to Amal (store unchanged).
4. Try opening `/users` or `/catalog` directly — you bounce back to the register.

**As the owner (Ayaan)** — `owner@agricope.qa` / `demo123`
1. The store picker appears: open a till in either store, or "All stores" for back office.
2. *Catalog*: search, filter by category, add a product (watch it validate a duplicate barcode),
   flip an Active toggle off — the product vanishes from the register grid, on again — it returns.
3. Create a category with *+ New category* and file a product under it.
4. *Users*: add a cashier with a till PIN, then hand the till to them via *Switch cashier · PIN*.

**Designed error paths worth seeing**: wrong password on login, wrong PIN on switch,
duplicate barcode or PIN, cashier hitting a manager URL.

Note: mock data lives in memory — restarting the dev server resets it to the seed world.
