# Agricope POS — frontend

Multi-tenant point of sale for shops and restaurants. React SPA per till; talks only to the
REST API described in `CONVENTIONS.md` (mocked in-browser until the real backend lands).

## Documents
- `CONVENTIONS.md` — **the API contract**: money as strings, error codes, the totals formula.
  The backend implements this; the frontend already speaks it.
- `docs/AGRICOPE-DESIGN-SPEC.md` — the complete UI specification: all 18 screens and
  19 overlays, every control, the rules that constrain them, and the visual language.
- `docs/SYSTEM-DESIGN.md` — the shorter narrative overview.
- `docs/SCHEMA-ALIGNMENT.md` — the frontend contract reviewed against the Postgres schema.
- `docs/original-system-design.md` — the original system design document.
- `DEPLOYMENT.md` — branches, environments, hosting and the release path.
- `docs/GCP-SETUP.md` — deploying to Google Cloud: Cloud SQL in Doha, loading the
  schema, and what still has to be built before the system can be "live".

## Repo layout
- `app/` — the React application (Vite + TypeScript)
- `docs/` — design and architecture documents

## Run it
```bash
cd app
npm install
npm run dev
```
The app runs against **MSW mocks** by default (no backend needed).

**Signing in: one login per business — the PIN says who you are.**
Sign in with the business account, pick the branch the till serves, then type your PIN.
Platform staff sign in on the same form and land on the **Agricope Console** (`/admin`):
every business and branch on the POS, plus onboarding — add a business, its branches,
and create its first owner login. Admins can also change a business's login email and
password from its console card; owners change their own password from *Settings*.

### Development seed data — mock mode only
These accounts exist **only in the in-browser mock world** (`app/src/mocks/`); they are
never part of a production build against the real API. Console: `admin@agricope.qa` /
`demo123`.

| Business login (password `demo123`) | Branches | PINs |
|---|---|---|
| `demo@agricope.qa` — Agricope Demo Trading Co. | Al Rayyan Store (retail), Karak Corner (restaurant) | Sara 1234 · Amal 2345 (Al Rayyan) · Yusuf 3456 (Karak) · Maryam 9999 (manager) · Ayaan 0000 (owner) |
| `drumsticks@agricope.qa` — Drumsticks (the first client; real menu & prices) | Drumsticks — Barwa Village (restaurant, prints kitchen tickets) | Rhea 3333 (cashier) · Imran 2222 (manager) · Yousuf 1111 (owner) |

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
- [x] Phase 13 — platform console & floor control: Agricope admin login + console (see all businesses/branches, onboard new ones with branches and an owner login), owner-only table CRUD from the floor ("Manage tables"), register Dine-in flow (order first, table optional — assign it on the tab later), "Switch user · PIN" wording, single logout button with a confirm pop-up
- [x] Phase 12 — multi-business & the Drumsticks menu: one login per business + PIN identity, per-business isolation (users, PINs, staff, catalog, orders), product parameters (Arabic name, multi-category, combos, customisable options like Spicy, time-bound offers, in-store vs online price — all tax-inclusive), Drumsticks' 65 products seeded from their pricing files, Staff page (check-in/out, add staff), owner-only user delete, KDS ↔ kitchen-ticket-printer toggle per branch, nav icons


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

**Drumsticks (the pilot client)** — `drumsticks@agricope.qa` / `demo123`, PIN `2222` (Imran, manager)
1. The register shows their real menu: category tabs from the pricing file, offer badges
   (−50% on the Fingers daily bucket) with struck-through prices.
2. Tap a Tender Box — the flavor sheet asks Normal / Spicy / Mix before it hits the cart;
   the choice rides to the kitchen ticket and the receipt.
3. Flip the register to *Online* — items ring at the online price list.
4. *Catalog* → edit a product: Arabic name, description, several categories (★ = where it
   reports), an offer with an end date, and its option groups are all editable.
5. *Staff* → check Omar in, watch "on the floor now" count, check him out — the day's
   attendance log builds under each card.
6. *Tables* → seat a table, add a round, *Send to kitchen* — this branch is set to
   **Ticket printer** in *Settings*, so a printable 80mm kitchen ticket pops instead of
   the KDS. Flip the toggle in *Settings* and the Kitchen screen comes back.
7. As the owner (PIN `1111`): *Users* → Delete removes a login entirely (managers can only
   deactivate). Drumsticks' users, PINs, staff and menu are invisible to the demo business,
   and vice versa.

**As platform staff** — `admin@agricope.qa` / `demo123`
1. The Agricope Console lists every business, its branches, owners, user and product counts.
2. *+ Add business* → branches → *Create owner* — the new business can sign in immediately
   (starter category included so its Catalog is not a dead end).

**Dine-in without a table (Drumsticks, PIN `2222`)**
1. On the register pick *Dine-in*, ring items, *Open tab* — the order exists with no table.
2. On the tab, *Assign table* offers the free tables; skipping is fine.
3. As the owner (PIN `1111`): *Tables* → *Manage tables* renames, resizes, adds and deletes
   tables (deleting needs a confirm; an occupied table refuses).

**Designed error paths worth seeing**: wrong password on login, wrong PIN on switch,
duplicate barcode or PIN, cashier hitting a manager URL, cash without an open shift,
credit past the limit, a discount above the threshold, editing a fired kitchen line.

Note: mock data lives in memory — restarting the dev server resets it to the seed world.
