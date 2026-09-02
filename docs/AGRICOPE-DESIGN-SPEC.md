# Agricope POS — Complete Design Specification

**Read this first.** This document describes **every screen, overlay, control and rule** in the
Agricope POS as it is actually built and running today. It supersedes any earlier summary.

**Rules for working from this document:**

1. **The system has 18 screens and 19 overlays. All of them are specified below.** If you are
   asked to design "the system", none of them may be dropped. Section 2 is the complete index —
   treat it as a checklist.
2. **Do not invent features.** If something is not in this document, it does not exist. Section
   14 lists what is deliberately absent.
3. **Do not simplify away the back office.** Catalog, Shifts, Reports, Staff, Users, Settings and
   the Platform Console are as much a part of the product as the till. They are listed last here
   only because the till is used more often.
4. **Respect the rules in Section 12.** They decide which screen states can exist. A design
   showing an impossible state is wrong even if it looks good.

---

## 1. The product in one page

A multi-tenant point of sale for **shops and restaurants in Qatar**. One installation serves many
independent **businesses** (tenants). Each business has one or more **branches**. Each branch runs
one or more **tills**.

Two rhythms, one system:

| | Retail shop | Restaurant |
|---|---|---|
| Core loop | Ring up → take money → next customer | Seat guests → orders build over time → pay at the end |
| Home screen | Register | Tables (floor) |
| Order life | Seconds | 45+ minutes |
| Kitchen | None | Ticket per station: KDS screen **or** printed ticket |

Restaurant-only screens (Tables, Kitchen) simply do not appear when the active branch is retail.

**Three business roles** — cashier, manager, owner — plus a **platform admin** who works for
Agricope, not for a business.

**Currency is QAR.** Prices are **tax-inclusive**. Money is displayed to two decimals.

---

## 2. Complete index — nothing here may be omitted

### 2.1 Screens (18)

| # | Screen | Route | Who | Shell? |
|---|---|---|---|---|
| 1 | Login | `/login` | everyone | no |
| 2 | Branch picker + PIN | `/pick-store` | business users | no |
| 3 | Register | `/` | cashier, manager, owner | yes |
| 4 | Tables (floor) | `/floor` | all — restaurant only | yes |
| 5 | Open tab | `/tab/:id` | all — restaurant only | yes |
| 6 | Orders | `/orders` | all | yes |
| 7 | Charge | `/charge/:id` | all | yes |
| 8 | Customers | `/customers` | all | yes |
| 9 | Kitchen (KDS) | `/kds` | all — restaurant + KDS mode | yes |
| 10 | Receipt (staff) | `/receipt/:id` | all | yes |
| 11 | Catalog | `/catalog` | manager, owner | yes |
| 12 | Shifts & cash drawer | `/shifts` | all | yes |
| 13 | Reports | `/reports` | manager, owner | yes |
| 14 | Staff | `/staff` | manager, owner (deactivate/delete: owner) | yes |
| 15 | Users | `/users` | **owner only** | yes |
| 16 | Settings | `/settings` | **owner only** | yes |
| 17 | Platform console | `/admin` | platform admin only | no (own chrome) |
| 18 | Public receipt | `/r/:token` | customer, no login | no |

### 2.2 Overlays and modals (19)

**Shared across screens (7)** — must look identical everywhere:
1. **PIN entry** — switch user, and the approval gate
2. **Money keypad** — every cash/amount entry
3. **Customer picker**
4. **Option picker** — required product choices
5. **Add items modal** — append a round to an existing order
6. **Discount dialog**
7. **Confirm dialog** — logout and similar

**Screen-owned (12):**
8. Credit limit modal (Charge, Customers)
9. Seat guests (Tables)
10. Manage tables (Tables, owner)
11. Split bill (Open tab)
12. Merge tab (Open tab)
13. Product editor (Catalog) — large two-column modal
14. Open shift / Close shift / Cash movement (Shifts — three related forms)
15. Repayment (Customers)
16. New customer (Customers)
17. User form (Users)
18. Staff form (Staff)
19. New business / Add branch / Create owner (Platform console) · plus the **printed kitchen ticket** layout

---

## 3. Roles and permissions

| Screen | Cashier | Manager | Owner |
|---|:--:|:--:|:--:|
| Register, Tables, Open tab, Orders, Charge, Customers, Kitchen, Receipt, Shifts | ✅ | ✅ | ✅ |
| Catalog, Reports, Staff | ❌ | ✅ | ✅ |
| Users, Settings | ❌ | ❌ | ✅ |
| Deactivate or delete a login | ❌ | ❌ | ✅ |
| Deactivate or delete a staff member | ❌ | ❌ | ✅ |
| Add, edit, check in/out a staff member | ❌ | ✅ | ✅ |
| Manage tables (add/edit/remove) | ❌ | ❌ | ✅ |
| Approve by PIN (discounts over threshold, void, refund, pull fired item, credit limit) | ❌ | ✅ | ✅ |

Cashiers who reach a manager route by URL are redirected to the Register. **Role-lean navigation
is a product principle**: a cashier facing a queue must never scan past "Reports" to reach
"Register". Never draw a full menu for a cashier.

---

## 4. Sign-in and session model

This is unusual and drives several screens — get it right.

**Login is per business, not per person.** One shared email and password puts the *branch* on the
system. **A 4-digit PIN then says who is standing at the till.** Handing over between cashiers
takes about two seconds and never signs the business out.

The full sequence:

```
Login (business email + password)
        ↓
Branch picker — "Which till?"   → tiles per branch, plus a "Back office" tile
        ↓
PIN screen — "Who is taking the till?"   → 4 dots + large keypad
        ↓
The app (sidebar + screens)
```

- The branch picker and PIN screen are **two stages of one route** (`/pick-store`). If the branch
  is already known (e.g. the till was locked), it opens straight on the PIN stage with a
  **← Change branch** link.
- **Switch user · PIN** in the sidebar re-opens PIN entry as an overlay without losing the branch.
- **Platform admin credentials are recognised on the same login form.** The form changes:
  a "Platform administrator" badge appears, the heading becomes "Agricope Console", the brand
  sub-line reads "PLATFORM CONSOLE", and sign-in goes to `/admin` instead of a till.
- **Owners** choosing "Back office" get no till — they land in the app for Catalog, Reports,
  Users, Staff and Settings, and the Register tells them to pick a branch first.

---

## 5. Navigation

Fixed left sidebar, full height and sticky; only the nav list scrolls. Three labelled groups:

```
SELL       Register · Tables* · Orders · Customers · Kitchen*†
MANAGE     Catalog‡ · Shifts · Reports‡ · Staff‡
ADMIN      Users§ · Settings§
```

`*` restaurant branches only · `†` also hidden when the branch prints tickets instead of using a
screen · `‡` manager and owner only · `§` **owner only** — a manager's hub has no ADMIN row at all.

Sidebar top: logomark + "Agricope", then a branch chip with a status dot.
Sidebar bottom, in order: **Switch user · PIN** button, current user's name and role, single
logout control (opens the confirm dialog).

Active item = **Fresh Leaf pill with dark green text** (not another Deep Forest fill — the
sidebar is already Deep Forest). Every nav item has an icon.

---

## 6. Selling screens

### 6.1 Register — `/`

The screen cashiers live in. Two panes.

**Left (flexible width):**
- **Search field** — "Scan barcode or search products…". Also receives USB barcode-scanner input
  (scanners type fast and press Enter; human typing is ignored by the detector).
- **Jump buttons** — `Tables` (restaurants only) and `Orders`, so staff reach the floor and the
  queue without the sidebar.
- **Order-type segment** — `Dine-in` (restaurants only) · `Takeaway` · `Online`.
  **There is no "Counter" option.** Takeaway is the default.
- **Category chips** — `All` plus one per category.
- **Product grid** — responsive tiles (min 180px). Each tile: a coloured category dot + category
  name, product name, price. If a discount runs **for the current channel**, the tile also shows
  a struck-through original price and a `−N%` badge.

**Right (fixed ~330px, sticky) — the cart:**
- Header: "Current sale" + branch chip.
- **Customer button** — dashed outline. Reads `+ Add customer` when empty; the customer's name
  plus "tap to change" when set. (Customers are for CRM, not only credit — never label this
  "for credit".)
- **Line items** — name, any chosen options, unit price, a `−` / qty / `+` stepper, line total.
- **Totals** — Subtotal, Service charge (dine-in only, when non-zero), "Incl. tax", **Total**.
- **Charge button** — full width, tall. Reads `Charge · QAR n` normally, `Open tab · QAR n` for
  dine-in.
- **Clear sale** — secondary.

**Behaviour:** tapping a product with required options opens the option picker first. Dine-in
goes to the **Open tab** screen; takeaway and online go to **Charge**.

**States:** empty cart ("Tap products to start the sale."), no products match, loading, owner
with no branch chosen (a centred card offering "Choose store").

### 6.2 Tables / Floor — `/floor` (restaurant)

The waiter's home screen.

- Header: "Floor — {branch}", sub-line "N open tabs · QAR n on tables". Owner sees **Manage
  tables**.
- **Zone chips** — `All zones` plus one per zone (Main hall, Terrace, Family section…), and a
  legend: Free / Occupied / 60+ min.
- **Table grid** — cards ~210px min, 150px tall:
  - Top row: table name (large), zone, status dot.
  - Occupied: "N guests · N min" (+ "N unsent" when items are not yet fired), and the running
    total in large green type.
  - Free: dashed border, "Seats N — tap to seat".
  - 60+ minutes: amber card and amber total — a nudge, not an alarm.
- Tapping a free table → **Seat guests** overlay (a `−` / count / `+` stepper, then "Open tab · N
  guests"). Tapping an occupied table → its Open tab.
- Refreshes every 10 seconds.

### 6.3 Open tab — `/tab/:id` (restaurant)

One table's bill as it grows.

- Header: `← Floor`, then "{table} — open tab" with "N guests · order number · cashier". If no
  table is assigned it reads "Dine-in — open tab … no table yet" and shows **Assign table**.
  Right: **Split bill**, **Merge**.
- **Items card** — header "Items" with "N not yet fired" / "all fired". Each line:
  - `NEW` badge (gold) = editable, with a quantity stepper.
  - `SENT` badge (grey) = locked, sub-line "locked — manager PIN to remove", and a **Pull…**
    action that opens the approval PIN.
  - Line total on the right.
  - Footer action: **+ Add items from menu**.
- **Right rail (~300px, sticky)** — "Bill so far": Subtotal, Discount (if any), Service charge,
  Incl. tax, **Total**; a "≈ QAR n per guest (N)" chip; then two buttons: **Send N items to
  kitchen** (gold, disabled when nothing is unsent) and **Charge · QAR n** (primary).

### 6.4 Orders — `/orders`

Today's queue and history.

- **Filter chips in this exact order: `Open` · `Completed` · `Void` · `Refunded` · `All`.**
  The page **opens on `Open`** — open orders are work in progress; "All" is a lookup.
- **Table** — Order · Time · Cashier · Type · Total · Status. Status pills: OPEN (gold),
  COMPLETED (green), VOID (orange), REFUNDED (grey).
- **Detail drawer** (on selecting a row, ~330px, sticky): order number + status pill; a meta line
  "cashier · time · type · table · customer" — a dine-in order with no table reads **"no table
  yet"**; the item lines with options; totals; payments (method, reference, tendered/change);
  any note; then actions:
  - **Open:** `+ Add items` *(only for dine-in orders with no table assigned)*, **Take payment**,
    **Void…**
  - **Completed:** **Receipt**, **Refund…**
  - **Void / Refunded:** **View receipt**
- Void and Refund open the approval PIN.

### 6.5 Charge — `/charge/:id`

Taking money. Two panes.

**Left — order summary (~340px, warm surface):** order number + status pill; item lines;
Subtotal, Discount, Service charge, Incl. tax, **Total**; a PAYMENTS list once payments exist;
a prominent gold **Remaining due** block; then two dashed buttons: attach/change **customer**,
and **% Order discount** (disabled once a payment exists).

**Right — take payment:**
- **Method segment (4):** `Cash` · `Card` · `Online` · `Credit`.
- **Credit banner** (only when Credit is selected) — one of three states:
  - no customer on the order → "Credit needs a customer on the order." + **Attach customer**
  - customer has no facility → "{name} has no credit facility." + **Give credit…**
  - customer has a facility → "Limit QAR n · owes QAR n · available QAR n" + **Raise limit…**
- **Amount display** — labelled "Tendered" for cash, "Amount" otherwise; large figure.
- **Change due** block (green) when cash tendered exceeds the amount due.
- **Reference field** for Card ("Card reference (last 4)") and Online ("Transfer / gateway
  reference").
- **Quick chips** — `Exact · n`, then 50 / 100 / 200 / 500.
- **Money keypad**.
- **Record button** — full width: "Record {method} payment · QAR n".
- Footnote: "Order completes automatically when payments cover the total — split freely."

**Paid state** replaces the pane with a centred card: green check, "Paid — QAR n", the order
number, change due if any, and **New sale** / **Receipt**.

**Errors appear inline above the record button**; a refused credit payment additionally offers
**Raise the limit…** in the error itself.

### 6.6 Customers — `/customers`

CRM first, credit second.

- Header "Customers", sub-line about ledgers; **+ New customer**.
- **Left list (~280px)** — search by name or phone; cards showing name and either
  "Owes QAR n" (orange) or "Settled", with "· no credit" appended when there is no facility.
- **Profile (right):**
  - Head card: name, "phone · email · notes", and **Receive payment** (disabled at zero balance).
  - **Three stat cards:** Outstanding · Credit limit (with a **Give credit… / Change…** link) ·
    Available.
  - **Statement card** — "Statement — newest first". Columns: date, type pill (CHARGE gold /
    REPAYMENT green / ADJUSTMENT grey), note, amount (+ orange / − green), running balance.
    Footer: "Balance is the sum of the ledger — nothing is ever edited in place."
- **New customer modal:** Name, Phone, Email. **No credit field** — plus the line "Credit is
  granted from the customer's profile — it needs a manager PIN."
- **Repayment modal:** amount display, quick chips (`Full · n`, 100/250/500), method segment
  (Cash/Card/Online), money keypad, record button; footnote that cash repayments need an open
  shift and print a receipt.

### 6.7 Kitchen / KDS — `/kds` (restaurant, KDS mode)

**The only dark screen in the product.** Designed to be read across a hot kitchen, full-screen on
a cheap tablet.

- **Header bar** (Deep Forest): "Kitchen display", station tabs (Kitchen / Bar / Grill…), and a
  large clock at the right.
- **Ticket cards** (~240px, dark green): header with order number + table name and an
  **elapsed-time pill** — green under 5 min, amber 5–10, red over 10; a status line (`NEW` /
  `IN PROGRESS`); item lines with the quantity in Fresh Leaf and any note in gold; a pulled item
  shows struck through with a `PULLED` flag.
- **One button per card, full width:** `Start` (orange) for new tickets, `Mark done` (Fresh Leaf)
  for in-progress ones.
- **Recently bumped rail** on the right — the last few done tickets with a check.
- Footer: "Full-screen on the kitchen tablet · refreshing every 5 s". Polls every 5 seconds.
- Empty: "All quiet — tickets appear here the moment a waiter hits Send."

### 6.8 Receipt (staff) — `/receipt/:id`

- **Left:** an 80 mm-wide receipt rendered in monospace — business name, branch, address, order
  number and time, cashier, type/table, customer; item lines; subtotal, discount, service charge,
  tax; **TOTAL**; payments with tendered/change; account balance when credit was used; a
  `*** VOID ***` / `*** REFUNDED ***` stamp when applicable; the business footer message.
- **Right:** **Print receipt** (primary), and a share card with a **QR code**, **Share on
  WhatsApp**, and **Copy link**, explained by "no login needed, the link is the secret".
- A dedicated print stylesheet hides everything except the receipt and sets 80 mm paper.

### 6.9 Public receipt — `/r/:token`

What the customer's phone opens. **No sidebar, no login, no actions** — just the same receipt
paper centred on the beige background. Invalid token: "This receipt link is not valid."

---

## 7. Back-office screens

**These are not optional.** Each is a full screen with its own header, actions and modals.

### 7.1 Catalog — `/catalog`

Products and categories for the whole business.

- Header: "Catalog", sub-line "N products · prices include tax · changes never touch old
  receipts"; **+ Add product**.
- **Toolbar:** search; category chips (`All` + each) and **+ New category** (inline create); a
  **Show inactive** checkbox on the right.
- **Table, six columns:** PRODUCT (name, `Combo` badge, Arabic name / description sub-line) ·
  PLACEMENT (primary category + "+N" when in several) · OFFER · STORE / ONLINE price ·
  ACTIVE toggle · Edit.
  - **OFFER shows both channels as separate stacked badges** — e.g. `−20% store` and
    `−40% online`. Live offers are filled, scheduled/expired ones are muted. `—` when neither.
- Inactive rows are greyed.

**Product editor — a large (~880px) two-column modal:**

*Left column*
- **Identity** — Name, Arabic name, Description ("What's inside a combo").
- **Categories** — chips; the first pick is starred as the primary (reporting) placement.
- **Routing & scanning** — kitchen station select, barcode.

*Right column*
- **Pricing & offer** — "All prices include tax." Three fields: **In-store**, **Online**
  (placeholder "same"), **Tax %**.
- **In-store discount panel** — title "In-store discount", hint "Counter, dine-in & takeaway
  tills", a toggle; when on: Percent off, Ends (date), and a live preview strip
  "IN STORE · QAR 3.60 · ~~4.50~~ · −20%".
- **Online discount panel** — title "Online discount", hint "Delivery & online orders only — set
  it apart from the shop", a toggle; when on: Percent off, Ends, a **Match the in-store
  discount** link, and its own preview strip "ONLINE · …".
  **The two are independent** — an in-store promotion does not touch the online price.
- **Customisable options** — option groups (e.g. Flavor: Normal / Spicy / Mix), each with a name,
  a required flag, and choice chips carrying an optional price delta. **+ Add option group**.
- Header of the modal carries an `OFFER LIVE` badge when a discount is running.
- Footer: "Deactivating hides it from the register — sold items keep their snapshot forever",
  then **Cancel** / **Save product**.

### 7.2 Shifts & cash drawer — `/shifts`

- Header: "Shift & cash drawer — {branch}"; sub-line either "Open since HH:MM · {who}" or
  "No open shift — cash is locked until one opens". When open: **+ Paid in / out** and
  **Close shift…**.

**When no shift is open** — an "Open a shift" card: explanation, an "Opening float" amount
display, a money keypad, and "Open shift with QAR n".

**When a shift is open** — two cards side by side:
- **X report — live drawer math**, one row per term with a signed badge:
  ```
      Opening float
  +   Cash sales
  +   Cash credit repayments
  +   Paid in
  −   Paid out
  −   Cash refunds
  =   Expected in drawer        (highlighted green)
  ```
- **Cash movements** — each with a PAID IN / PAID OUT pill, reason, time, who, and a signed
  amount.

**Shift history** table below: date, who, open–close times, and an outcome pill — `OPEN` (gold),
`BALANCED` (green) or `SHORT/OVER n` (orange).

**Close shift modal:** shows the server-computed expected figure, a "Counted" amount display, a
**live over/short banner** (green "Drawer balances exactly" or orange "Short QAR n"), keypad,
"Close shift & produce Z report", and the warning "Closing is permanent — the Z report becomes
the record of this drawer."

**Z report card** after closing: the same arithmetic rows plus a gold "Counted" row and a
BALANCED / SHORT pill in the header.

**Cash movement modal:** Paid out / Paid in segment, a reason field, amount display, keypad.

### 7.3 Reports — `/reports`

- **Range selector:** `Today` · `7 days` · `Month`. Every comparison re-labels itself
  ("vs yesterday", "vs previous 7 days", "vs previous 30 days").
- **KPI cards** with day-over-day deltas (▲ green / ▼ orange, or "no comparison"):
  Gross sales · Order count · Average order · Discounts given · Credit outstanding.
  Void and refund counts ride along as sub-text.
- **Sales by hour** — bar chart, peak highlighted.
- **Payment mix** — Cash (Deep Forest) · Card (Fresh Leaf) · Online (Gold) · Credit (Orange),
  as a stacked bar plus per-method share bars with amounts and percentages. Credit is the one
  that hurts, so it carries the orange.
- **Order-type split** — chips with amounts.
- **Top items** — rank, name, quantity sold, revenue.
- **Credit ageing** — buckets `Current` · `30–59 days` · `60–89 days` · `90+ days`; only the
  genuinely overdue buckets take colour. Named debtors listed underneath with their age in days.
- Owners see all branches; managers see theirs.

### 7.4 Staff — `/staff`

Workforce attendance. **Distinct from Users: staff need no login.**

- Header: "Staff", sub-line "{branch} · N on the floor now · check-ins write the attendance log";
  **+ Add staff**.
- **Stat strip (4):** On the floor · Off the floor · Hours logged today · First check-in.
- **Staff cards** in a grid:
  - Avatar with initials, name, "{role title} · {branch}", and a status pill —
    "In since HH:MM" (green) or "Off floor" (grey).
  - Middle: "Today · 3h 20m" and the day's entries as "09:12–13:04 · 14:00–now", or
    "no entries today".
  - Actions: **Check in** (primary) or **Check out** (secondary), plus **Edit** — a manager
    gets these. **Deactivate / Restore** and **Delete** appear for the owner alone, and
    Delete only once the person is deactivated. The form's "Active" checkbox is owner-only too.
  - Inactive staff are greyed and cannot be checked in.
- **Staff form modal:** Name, Role ("Fry cook, Counter, Cleaner…"), Branch select (or "All
  branches"), and an "Active — can be checked in" checkbox.

### 7.5 Users — `/users`

Till logins for this business.

- Header: "Users", sub-line "Till logins for this business · the PIN is who you are on the till";
  **+ Add user**.
- **Owner-only note** banner: an "Owner only" tag plus "Only the owner can delete a login.
  Managers can deactivate, which keeps the person on past receipts."
- **Table:** Person (avatar initials + name, plus a "Deactivated" flag) · Email · Role (a coloured
  role pill: cashier / manager / owner) · Branch ("All branches" when unassigned) · PIN (`••••`
  or `—`) · actions.
- Actions: **Edit** for everyone; **Delete** only for owners, and never on their own row.
  Deleting asks for confirmation ("Their login and PIN stop working immediately").
- **User form modal:** Name, Email, Role select, Store select, **Till PIN (4 digits — blank keeps
  current)**, and "Active — can sign in".
- **PINs are write-only.** The list never reveals one, only whether it is set.

### 7.6 Settings — `/settings`

Branch settings, one card per branch (only the active branch when a till is open).

- Header: "Settings", sub-line "Branch & business settings · owner only".
- **Branch card:** name, "{type} · {address}", and a type pill (Retail / Restaurant).
- **Kitchen output block** — title, explanation, then a **radio group of two large option cards**:
  - **KDS board** — "Live tickets on a screen at the pass, bumped by the kitchen."
  - **Ticket printer** — "Prints an 80mm ticket on send. The Kitchen screen is hidden on this
    branch."
- **Effect strip** below, tagged "Effect", stating what the current choice actually does — e.g.
  "Kitchen disappears from the sidebar · 'Send to kitchen' opens a printable ticket instead".
  **Say what a switch changes before it is made.**

### 7.7 Platform console — `/admin`

Agricope staff only. **Its own chrome — no POS sidebar.**

- **Top bar:** logomark, "Agricope Console", a "Platform admin" tag; right side shows the admin's
  name and **Log out**.
- Head: "Businesses on the platform", sub-line "Every tenant running the POS, their branches and
  their owner logins"; **+ Add business**.
- **Stat strip (5):** Businesses · Branches live · Till logins · Products catalogued ·
  **Awaiting an owner** (rendered orange when non-zero — it is the number that blocks a tenant).
- **Business cards**, each containing:
  - A coloured monogram (a stable tone per tenant so cards are tellable apart), the business name,
    and "Login · {email}".
  - A count row: N users · N products · N branches.
  - **Branches section** — "+ Add branch"; each row has a Retail/Restaurant type pill, name and
    address. Empty: "No branches yet — add the first one."
  - **Owner logins section** — "+ Create owner"; each row has an avatar, name, email and a
    "PIN set" / "No PIN yet" flag. When there are none, a **blocked** notice: "No owner yet —
    this business cannot sign in until you create one." (State what is blocked, not just what is
    missing.)
- **Three modals:** New business (name, login email, password) · Add branch (name, Retail /
  Restaurant, address) · Create owner (name, email, optional PIN).

---

## 8. Entry screens

### 8.1 Login — `/login`

Split screen, no sidebar.

- **Left brand panel** (Deep Forest, decorative circles): logomark + "AGRICOPE" and a sub-line
  that reads **"POINT OF SALE"** normally and **"PLATFORM CONSOLE"** for admin credentials; a
  headline and blurb; a copyright footer.
- **Right card:** heading "Welcome back" (or "Agricope Console"), a sub-line, Email and Password
  fields, a full-width sign-in button, an inline error, and a demo-credentials hint tagged
  "Demo".
- A **"Platform administrator"** badge appears above the heading when admin credentials are
  recognised — the whole screen re-skins itself for admins.
- A warning appears if a staff member tries to sign in with the wrong kind of credential.
- On success: platform admins → `/admin`; businesses → the branch picker.

### 8.2 Branch picker + PIN — `/pick-store`

**One route, two stages, no sidebar, dark forest background.** This is where the business session
becomes a *person* at a *till*.

**Stage 1 — choose the till.**
- Centred: logomark, the **business name** as the heading, and a short instruction.
- **Branch tiles** in a row (~230px each, white cards): a Retail/Restaurant type pill, the branch
  name, and its address.
- A final **"Back office"** tile (forest-tinted, visually distinct): "All branches — catalog,
  users, reports". Choosing it gives no till.
- **Sign the business out** at the bottom.

**Stage 2 — say who you are.**
- A single centred **PIN card** containing, top to bottom:
  - a branch chip with a status dot — the branch name, or "{business} · Back office";
  - a large `?` avatar and the heading **"Who is taking the till?"**;
  - either the hint "Enter your 4-digit PIN" or, on failure, the error in its place;
  - **four dots** (large size) that fill as digits are entered;
  - a **large keypad** (76px keys);
  - a **← Change branch** link back to stage 1.
- **Sign the business out** sits outside the card.
- Auto-submits on the fourth digit. A wrong PIN clears the dots and shows the error inline.
- If the branch is already known (the till was locked), the route **opens directly on stage 2**.

---

## 9. Shared overlays — identical everywhere they appear

**PIN entry** — used for switching user *and* for approvals. A card with: title, one-line
explanation, four dots that fill as digits are entered, a large 3×4 keypad (keys 72–76px),
auto-submit on the fourth digit, an inline error that clears the dots, and Cancel.
Approval variants name the action: "Approve discount", "Void S1-0042", "Approve new credit line",
"Pull a fired item".

**Money keypad** — the same keypad with `.` in place of the fourth-row blank, used for tendered
cash, repayments, floats, counted cash and credit limits. Always paired with a large amount
display above it.

**Customer picker** — search field, result rows (name, phone, balance or "settled", "· no
credit"), and **No customer** / **Cancel**.

**Option picker** — asks required choices before an item joins the sale; choices render as chips
with any price delta shown.

**Add items modal** — title, search, category chips, a compact product grid where tapping
increments and shows a `×N` badge, and "Add N items {to tab|to order}". Used by the Open tab and
by Orders.

**Discount dialog** — Percent / Fixed segment, a value field, a **mandatory reason** field, and
Apply. Above the business threshold it escalates to the approval PIN.

**Credit limit modal** — "Give credit to {name}" or "Raise credit limit — {name}", an explanation
of the current standing and what this sale needs, a "New limit" amount display, quick chips
(including **Just enough · n**), a money keypad, a warning if the entered limit is still too low,
then **Continue — needs manager PIN** which hands off to the approval PIN.

**Confirm dialog** — title, body, cancel and a confirm button that takes the destructive tone
when appropriate.

**Printed kitchen ticket** — an 80 mm print layout for branches in printer mode: order number,
table, time, and the items for that station.

---

## 10. Visual language

### Colour tokens

| Token | Hex | Role |
|---|---|---|
| Deep Forest | `#0A5038` | Structure — sidebar, primary buttons, prices |
| Forest deep | `#083D2B` | Pressed state, login brand panel |
| Forest tint | `#11543C` | Sidebar surfaces, KDS cards |
| Fresh Leaf | `#66BB6A` | Living accent — logo arch, active nav pill, positive states |
| Leaf ink | `#06301F` | Text on Fresh Leaf |
| Soft Earth Beige | `#F1EDDC` | App background |
| Surface | `#FFFFFF` | Cards |
| Surface warm | `#F8F5E8` | Table headers, keypad keys, summary panes |
| Border | `#E4DFCB` | Hairlines |
| Sunset Orange | `#D94720` | Calls to action **and** destructive — **no other red exists** |
| Orange tint | `#FBE0D6` | Error backgrounds |
| Golden Harvest | `#FFD85E` | Attention — open orders, remaining due, unsent items, Send button |
| Gold tint | `#FFF1C2` | Attention backgrounds |
| Success tint | `#DFEFDB` | Positive backgrounds |
| Ink | `#0F172A` | Primary text |
| Ink 2 / Ink 3 / Hint | `#575649` / `#6E6C5C` / `#9C998A` | Secondary text, labels, hints |
| KDS dark | `#05261A` | Kitchen screen background only |

### Type
- **Inter** — headings, numbers, buttons, money.
- **Roboto** — body text, labels, table cells.
- Base size 14px. Money is never smaller than its own label.

### Form
- Radius: 10px controls, 16px cards, 99px pills.
- **No interactive control below 48px tall.** Keypad keys 72–76px.
- One primary action per screen, full width where it is the point of the screen.
- Shared control classes are defined once globally — `.btn-primary`, `.btn-secondary`, `.chip`,
  `.toggle`, `.badge`, `.card`, `.field`. Page styles must not redefine them.

### Logo
An arch over field rows — the farm-to-table bridge. All-white on dark green or photography;
two-tone (Fresh Leaf arch, Deep Forest rows) on light. Wordmark stacks AGRI / COPE.

---

## 11. Designing for touch

Every till is a touchscreen; many are tablets.

- Product tiles, table cards and method buttons are large targets with generous spacing.
- **Every money entry has an on-screen keypad** — never assume a keyboard.
- Quantities use `−` / value / `+` steppers, never typed input.
- The most frequent action sits at the bottom of the panel it belongs to, under the thumb.
- Totals and counts read at arm's length; the KDS reads across a room.
- Destructive actions never sit beside frequent ones.

---

## 12. Rules that constrain the design

Enforced server-side. A design that contradicts these shows an impossible state.

**Prices are tax-inclusive.** What is shown is what the customer pays; tax is *extracted* as a
memo. Label it "Incl. tax" — never add it on top.

**Totals, in this exact order:**
```
line_total     = unit_price × quantity − line discount
subtotal       = Σ line_total
discount_total = order discount applied to subtotal
service_charge = rate × (subtotal − discount_total)     [dine-in only]
total          = subtotal − discount_total + service_charge
```

**An order completes only when payments cover the total.** Until then it is `open` with a
remaining balance — which is why "Remaining due" is the loudest figure on Charge. Split payments
are normal, not an edge case.

**Nothing is deleted.** Products deactivate; orders void or refund; merged tabs close with a note.
Sold lines keep a permanent snapshot of name and price, so old receipts never change when a
product is renamed or repriced.

**Cash requires an open shift.** Cash sales, cash refunds and cash repayments are refused without
one. The empty state must offer to open a shift, not merely report failure.

**Sensitive actions need a manager or owner PIN**, always through the same overlay: discounts over
the business threshold, voids, refunds, pulling an item the kitchen already has, and setting a
credit limit. The pattern is **attempt → 403 → PIN → retry**. Design the optimistic path first;
the PIN interrupts, it is not a gate you pass beforehand.

**Customers are CRM records first.** Most have no credit facility. Creating one captures name,
phone and email only. Credit is granted afterwards — from the profile or mid-charge — and always
needs a manager PIN.

**Discounts are per channel.** Each product carries an independent in-store discount and online
discount, each with its own percentage and time window. They never leak into one another. The
till applies whichever belongs to the order's channel.

**Credit is a ledger, not a number.** A balance is the sum of append-only entries (charge,
repayment, adjustment). The statement explains every figure; nothing is edited in place.

**One open shift per branch. One open tab per table.**

---

## 13. Vocabulary — use these words exactly

**Business** — a tenant. **Branch** — one outlet. **Till** — one register session.
**Shift** — a cash-drawer session, opened with a float, closed with a count.
**Tab** — a dine-in order that stays open while guests eat. **Round** — items added to a tab at
one time. **Fire / Send** — release items to the kitchen. **Bump** — mark a kitchen ticket done.
**Cover / guest count** — people at a table. **X report** — mid-shift drawer figures.
**Z report** — the permanent close-of-shift record. **Over / short** — counted minus expected.
**Charge** (verb, credit sense) — put a sale on a customer's account.
**Statement** — a customer's ledger with a running balance.
**Snapshot** — the copied name and price stored on a sold line.
**Station** — a kitchen destination (Kitchen, Bar, Grill).

---

## 14. Deliberately absent — do not design these

Stock and inventory levels · offline mode · Arabic RTL layout (Arabic *names* are stored and
shown, but the layout is LTR) · loyalty points · payment-gateway processing (online payments are
**recorded**, not processed) · table reservations · supplier or purchase orders · payroll (Staff
tracks attendance only) · multi-currency.

---

## 15. States that must be designed for every screen

Screens fail on these far more often than on the happy path:

- **Empty** — no products, no orders today, no open tabs, no credit history, no staff, no
  businesses, quiet kitchen.
- **Loading** — lists and reports fetch; never leave a blank frame.
- **No shift open** — cash refused, with a route to opening one.
- **No branch chosen** — an owner in back office cannot use the till.
- **Approval required** — the PIN overlay interrupts, succeeds or fails, and returns.
- **Refused credit** — over limit, or no facility at all, each with a way forward.
- **Locked items** — the kitchen already has them; editing needs approval.
- **Partly paid** — some payments recorded, a balance remaining.
- **Void / refunded** — read-only, clearly stamped, still printable.
- **Deactivated** — products and users greyed but never gone.
- **Blocked tenant** — a business with no owner login cannot sign in.

---

*Companion files in the repo: `CONVENTIONS.md` (API contract, error codes, the totals formula)
and `README.md` (how to run it, demo credentials).*
