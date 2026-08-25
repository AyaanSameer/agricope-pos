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
- [x] Phase 3 — counter sales & payments ★: cart, charge screen, cash tendered/change, split payments, orders history
- [x] Phase 4 — receipts & barcode: 80mm print stylesheet, public `/r/:token` e-receipt, QR + WhatsApp share, scan listener
- [x] Phase 5 — customers & credit: statements with running balance, receive payment, credit as a payment method with limits
- [x] Phase 6 — shifts & cash drawer: open/close with server-computed expected cash, X/Z reports, paid in/out, cash gating
- [x] Phase 7 — discounts & approvals: threshold from settings, 403 APPROVAL_REQUIRED → manager-PIN retry, void/refund PIN
- [x] Phase 8 — tables & tabs: floor view, seat guests, rounds, sent-item locks, split bill, merge, service charge
- [x] Phase 9 — kitchen & KDS: send groups by station, dark KDS board with elapsed coloring and bumping, 5s polling
- [x] Phase 10 — dashboard & reports: KPIs, sales by hour, payment mix, top items, FIFO credit aging
- [x] Phase 11 — hardening: production build clean, 17 unit tests (money + the pinned totals formula), walkthroughs below


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

**A retail day (Sara at Al Rayyan)**
1. Ring a sale: tap products, adjust quantities, Charge → take cash with tendered/change, or split cash + card.
2. Attach a customer and pay part or all with *Credit* — watch the limit block when it should.
3. *Customers* → open a statement → *Receive payment* on the keypad.
4. *Shifts* → watch the live X report absorb every cash move → close the drawer and read the Z report over/short.
5. Close the shift, then try a cash sale: `NO_OPEN_SHIFT` locks the drawer until a new float is counted.
6. Give a 20% discount on the charge screen: it demands a manager PIN (`9999`); 5% sails through.

**A restaurant service (Yusuf at Karak Corner)**
1. *Tables* → tap a free table, seat guests → the tab opens empty.
2. Add a round from the menu, *Send to kitchen* → *Kitchen* shows the ticket per station; bump it Start → Done.
3. Add a second round — it fires as a new ticket ("fire the mains" for free). Fired lines lock; pulling one needs a PIN.
4. *Split bill* moves lines to a new order that pays on the normal charge screen — service charge (10%) rides along.
5. *Reports* shows the day: payment mix, top items, credit aging.

**Designed error paths worth seeing**: wrong password on login, wrong PIN on switch,
duplicate barcode or PIN, cashier hitting a manager URL, cash without an open shift,
credit past the limit, a discount above the threshold, editing a fired kitchen line.

Note: mock data lives in memory — restarting the dev server resets it to the seed world.
