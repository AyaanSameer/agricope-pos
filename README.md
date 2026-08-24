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
- `sara@alrayyan-market.qa` — cashier, Al Rayyan Store
- `yusuf@karakcorner.qa` — cashier, Karak Corner (restaurant)
- `owner@agricope.qa` — owner, all stores

To point at the real API set `VITE_USE_MOCKS=false` in `app/.env.local`.

## Stack
React 19 · Vite · TypeScript · TanStack Query · React Router · MSW · big.js (money — never floats)

## Phase status (see frontend-workflow doc)
- [x] Phase 0 — foundations & contract: auth against mock, routing, brand theming, `money.ts`, conventions written down
- [ ] Phase 1 — auth & org (PIN switch, store picker, users admin)
- [ ] Phase 2 — catalog · Phase 3 — register & payments ★ · …
