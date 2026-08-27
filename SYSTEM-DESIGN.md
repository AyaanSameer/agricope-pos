# Agricope POS — System Design (for design work)

**What this document is.** A complete description of how the Agricope POS actually works
today: who uses it, what every screen does, the rules that govern the money, and the visual
language it is built in. Attach it when designing new screens or redesigning existing ones so
the design matches the working system rather than guessing at it.

**Status:** built and running as a React SPA against a mock API. 12 build phases complete plus
two refinement phases. Every screen described here exists in code.

---

## 1. What the product is

A multi-tenant point of sale for **shops and restaurants in Qatar**. One installation serves
many independent businesses; each business has one or more branches; each branch runs tills.

A single system covers two quite different rhythms:

| | Retail shop | Restaurant |
|---|---|---|
| Pace | Ring up, take money, next customer | Guests sit, order over time, pay at the end |
| Core screen | Register | Floor → open tab |
| Order lifecycle | Seconds | 45+ minutes |
| Kitchen | None | Tickets to stations, or a printed ticket |

The same screens serve both. Restaurant-only features (Tables, Kitchen) simply do not appear
when the active branch is a retail store.

### Deliberately not in scope
Stock/inventory, offline mode, Arabic RTL layout, loyalty points, and payment-gateway
integration. Online payments are *recorded*, not processed. Designs should not imply these
exist.

---

## 2. Who uses it

Three roles inside a business, plus a platform operator.

**Cashier** — lives on the Register. Sells, takes payment, looks after their drawer, handles
customers. Cannot see Catalog, Reports, Users, Staff or Settings.

**Manager** — everything a cashier does, plus Catalog, Reports, Users, Staff. Approves
sensitive actions with a PIN.

**Owner** — everything, plus Settings and branch/table management. Works across all branches
and picks which one to open a till in.

**Platform admin** — Agricope staff, not a business user. Signs in on the same form and lands
on a separate console at `/admin` to onboard new businesses. Never sees a till.

### The two-step sign-in
Login is **per business**, not per person: one shared email and password gets the branch onto
the system. **The PIN identifies the person.** A four-digit PIN hands the till from one cashier
to the next in about two seconds, without signing out. This is why PIN entry appears everywhere
and must always be a large, confident keypad.

### Role-lean navigation
Each role sees only what it needs. This is a product principle, not an implementation detail:
a cashier facing a queue should never scan past "Reports" to find "Register". Designs must not
show a full menu to a cashier.

---

## 3. Navigation model

A fixed left sidebar, always present inside the app, grouped into three labelled sections:

```
SELL      Register · Tables* · Orders · Customers · Kitchen*
MANAGE    Catalog† · Shifts · Reports† · Staff†
ADMIN     Users† · Settings‡
```

`*` restaurant branches only · `†` manager and owner · `‡` owner only ·
Kitchen also hides when the branch prints tickets instead of using a screen.

The sidebar bottom holds, in order: the **Switch user · PIN** button, the current user's name
and role, and a single logout control. The sidebar is full-height and sticky; only the nav
list scrolls.

Outside the shell sit four screens with no sidebar: **Login**, **Branch picker**, **Platform
console**, and the **public receipt** page.

---

## 4. Screen inventory

### Sell

**Register** (`/`) — the screen cashiers live in.
Left two-thirds: a search field that also accepts barcode scans, an order-type segment, a row
of category chips, and a grid of product tiles. Right third: a sticky cart panel — customer
button, line items with quantity steppers, totals, and one large **Charge** button.

Order type is **Dine-in · Takeaway · Online** (Dine-in only in restaurants). *There is no
"Counter" option* — it was removed. Takeaway is the default. Dine-in opens a tab instead of
going to payment.

Top-right of the search row: **Tables** and **Orders** jump buttons, so staff can reach the
queue and the floor without going to the sidebar.

Tiles show category, name, price, and — when a discount is running for the current channel —
a struck-through original price and a percentage badge.

**Tables / Floor** (`/floor`, restaurants) — the waiter's home. Cards for every table showing
zone, state (free / occupied / 60+ minutes), guest count, minutes open, unsent item count and
running total. Tapping a free table asks for guest count and opens a tab; tapping an occupied
one opens it. Owners get a "Manage tables" affordance here.

**Open tab** (`/tab/:id`) — one table's bill as it grows. Items are marked **NEW** (editable)
or **SENT** (locked — removing one needs a manager PIN and flags the kitchen ticket). Actions:
add a round, send to kitchen, split bill, merge another tab, assign a table if it has none, and
charge. Right rail shows the running bill with service charge and a per-guest figure.

**Orders** (`/orders`) — today's queue and history. Filter chips read **Open · Completed · Void
· Refunded · All**; the page opens on **Open**, because open orders are work in progress and
"All" is a lookup, not the default view. A table lists order number, time, cashier, type, total
and status; selecting a row opens a detail drawer with lines, totals, payments, and actions.

Open dine-in orders that have **no table assigned** can be topped up right here with **+ Add
items** — a stall-side or phoned-in order does not need a table to grow.

**Charge** (`/charge/:id`) — taking money. Left: the order summary with a prominent
**Remaining due**. Right: a four-way method segment (Cash · Card · Online · Credit), an amount
display, quick-amount chips, a numeric keypad, and one large record-payment button.

Split payments are the normal case, not an edge case: each payment reduces the due, and the
order completes automatically when payments cover the total. Cash shows tendered and change.
Card and Online take a reference. Credit shows the customer's limit, balance and available
credit — and offers to grant or raise the limit inline (see §6).

**Customers** (`/customers`) — a CRM list with search, a profile, and an append-only statement
with a running balance. Actions: receive a payment, grant or change credit.

**Kitchen / KDS** (`/kds`, restaurants with a screen) — a dark, full-screen board meant for a
cheap tablet across a hot kitchen. Station tabs at the top; tickets as cards with elapsed-time
colouring (green → amber → red); one button per card: **Start**, then **Mark done**. Polls
every five seconds. This is the only dark screen in the product.

### Manage

**Catalog** (`/catalog`) — products and categories. A six-column table (product, placement,
offer, store/online price, active, edit) with search, category chips and an inactive toggle.
Editing opens a two-column editor: identity and categories on the left; pricing, discounts and
customisable options on the right.

**Shifts** (`/shifts`) — the cash drawer. When closed: an open-shift card asking for a counted
float. When open: a live **X report** showing the drawer arithmetic line by line, a cash
movements list, and paid in/out and close actions. Closing asks for a counted amount, shows
over/short live, and produces a permanent **Z report**.

**Reports** (`/reports`) — the day, visualised. A range selector (today / 7 days / month), KPI
cards with day-over-day deltas, sales by hour, payment mix, order-type split, top items, and
credit ageing by bucket.

**Staff** (`/staff`) — workforce attendance (check in / check out). Separate from Users:
staff are people who work; users are logins.

### Admin

**Users** (`/users`) — logins, roles and till PINs. PINs are write-only: the list shows only
whether one is set.

**Settings** (`/settings`, owner) — branch configuration: service charge rate, kitchen mode
(screen or printer), and similar per-branch choices as radio cards with an "effect" strip
explaining what each changes.

### Outside the shell

**Login** — split screen: brand panel left, card right. Recognises platform-admin credentials
and routes them to the console.

**Branch picker** — where owners choose which branch to work in, or "All branches" for back
office.

**Platform console** (`/admin`) — a stat strip and a list of businesses, with onboarding for a
new business (business + branches + first owner login).

**Public receipt** (`/r/:token`) — an unauthenticated page the customer opens from a QR code or
WhatsApp link. The token *is* the secret. No sidebar, no login, just the receipt.

**Receipt** (`/receipt/:id`) — staff-side: an 80 mm thermal-shaped receipt with a print
stylesheet, plus a QR code, WhatsApp share and copy-link panel.

---

## 5. Overlays and shared controls

Recurring pieces that must look and behave the same wherever they appear:

- **PIN keypad overlay** — switching user, and approving anything sensitive. Four dots, a
  large 3×4 keypad, auto-submit on the fourth digit, inline error, cancel.
- **Money keypad** — same keypad shape with a decimal point, used for cash tendered,
  repayments, floats, counted cash and credit limits.
- **Customer picker** — search and pick, or "No customer".
- **Option picker** — asks for required choices (e.g. Flavor: Normal / Spicy / Mix) before an
  item joins the sale.
- **Add items modal** — a compact product grid for appending a round to an existing order.
  Shared by the tab and the Orders page.
- **Discount dialog** — percent or fixed, plus a mandatory reason.
- **Confirm dialog** — for logout and other irreversible-feeling actions.
- **Printed kitchen ticket** — an 80 mm print layout for branches without a kitchen screen.

---

## 6. The rules that shape the screens

These are enforced server-side. Designs must respect them or they will show states that cannot
happen.

**Money is decimal strings, never floats, and prices are tax-inclusive.** What you see is what
the customer pays; tax is extracted as a memo line, never added on top. Show it as "Incl. tax".

**Totals, in this exact order:**
```
line_total     = unit_price × quantity − line discount
subtotal       = Σ line_total
discount_total = order discount applied to subtotal
service_charge = rate × (subtotal − discount_total)     [dine-in only]
total          = subtotal − discount_total + service_charge
```

**An order completes only when payments cover the total.** Until then it is `open` with a
remaining due. This is why "Remaining due" is the loudest number on the Charge screen.

**Nothing is deleted.** Products deactivate; orders void or refund; merged tabs close with a
note. Sold lines keep a snapshot of name and price forever, so old receipts never change when
you rename or reprice a product. The Catalog editor says this out loud.

**Cash needs an open shift.** Cash sales, cash refunds and cash repayments are refused when the
branch has no open drawer. The empty state must offer opening a shift, not just report failure.

**Sensitive actions need a manager or owner PIN**, always through the same overlay: discounts
above the business threshold, voids, refunds, pulling an item the kitchen already has, and
setting a credit limit. The pattern is: the action is attempted → the API answers
`403 APPROVAL_REQUIRED` → the PIN overlay appears → the action retries with the PIN. Design the
optimistic path first; the PIN is an interruption, not a gate you pass before starting.

**Customers are CRM records first.** Most have no credit facility. Creating a customer captures
name, phone and email — no credit. Credit is granted afterwards, from the profile or mid-charge,
and always needs a manager PIN. On the Charge screen, picking **Credit** for a customer with no
facility says so plainly and offers **Give credit…** right there; if a credit payment is refused
for exceeding a limit, the error itself offers **Raise the limit…**.

**Discounts are per channel.** A product carries two independent discounts — one for in-store
(counter, dine-in, takeaway) and one for online/delivery — each with its own percentage and
time window. They do not leak into each other: an in-store promotion leaves the online price
alone. The till applies whichever belongs to the order's channel, and the Catalog list shows
both as separate badges ("−20% store", "−40% online").

**Credit is a ledger, not a number.** A customer's balance is the sum of append-only entries
(charge, repayment, adjustment). The statement explains every figure; nothing is edited in
place.

---

## 7. Visual language

Taken from the AGRICOPE brand guidelines (May 2025).

### Colour
| Token | Value | Role |
|---|---|---|
| Deep Forest | `#0A5038` | Structure: sidebar, primary buttons, prices |
| Forest deep / tint | `#083D2B` / `#11543C` | Pressed states, sidebar surfaces |
| Fresh Leaf | `#66BB6A` | The living accent: logo arch, active nav pill, positive states |
| Soft Earth Beige | `#F1EDDC` | App background |
| Surface / warm | `#FFFFFF` / `#F8F5E8` | Cards, table headers, keypads |
| Border | `#E4DFCB` | Hairlines |
| Sunset Orange | `#D94720` | Calls to action **and** destructive — no other red exists |
| Golden Harvest | `#FFD85E` | Attention: open orders, remaining due, unsent items |
| Ink / secondary / hint | `#0F172A` / `#575649` / `#9C998A` | Text |
| KDS dark | `#05261A` / `#11543C` | Kitchen screen only |

Active navigation is a **Fresh Leaf pill with dark green text** — the logo's own two-green
relationship — because the sidebar and primary buttons are both Deep Forest.

### Type
**Inter** for headings, numbers and buttons. **Roboto** for body text and labels. Money is
always Inter, tabular, and never smaller than its label.

### Form
- Corner radius 10 px, cards 16 px.
- **No interactive control below 48 px tall.** Keypad keys are 72–76 px.
- One primary action per screen, full width where it is the point of the screen.
- Shared control classes — `.chip`, `.toggle`, `.badge`, `.btn-primary`, `.btn-secondary`,
  `.card`, `.field` — are defined once globally. Page styles must not redefine them.

### Logo
An arch over field rows — the farm-to-table bridge. All-white on dark green or photography;
two-tone (Fresh Leaf arch, Deep Forest rows) on light. The wordmark stacks AGRI / COPE.

---

## 8. Designing for touch

Every till is a touchscreen; many are tablets. This drives more decisions than anything else:

- Product tiles, table cards and method buttons are large tap targets with generous spacing.
- Every money entry has an on-screen keypad — never assume a keyboard.
- Quantity uses `−` / value / `+` steppers, not typed numbers.
- The most frequent action sits under the thumb, bottom-right of the panel it belongs to.
- Counts and totals are readable at arm's length; the KDS is readable across a room.
- Destructive actions never sit next to frequent ones.

---

## 9. Vocabulary

Use these words exactly; they appear throughout the UI.

**Business** — a tenant. **Branch** (or store) — one outlet. **Till** — one register session.
**Shift** — a cash-drawer session, opened with a float and closed with a count.
**Tab** — a dine-in order that stays open while guests eat. **Round** — items added to a tab at
one time. **Fire / Send** — release items to the kitchen. **Bump** — mark a kitchen ticket done.
**Cover / guest count** — people at a table. **X report** — mid-shift drawer figures.
**Z report** — the permanent close-of-shift record. **Over / short** — counted minus expected
cash. **Charge** (verb) — put a sale on a customer's credit account. **Statement** — a
customer's ledger with running balance. **Snapshot** — the copied name and price stored on a
sold line.

---

## 10. States that must be designed

Screens fail more often on these than on the happy path:

- **Empty** — no products, no orders today, no open tabs, no credit history, quiet kitchen.
- **No shift open** — cash is refused; the screen should offer to open one.
- **No branch chosen** — an owner who has not picked a branch cannot use the till.
- **Approval required** — a PIN overlay interrupts, succeeds or fails, and returns.
- **Refused credit** — over limit, or no facility at all, each with a way forward.
- **Locked items** — kitchen already has them; editing needs approval.
- **Partly paid** — an order with some payments and a remaining balance.
- **Void / refunded** — read-only, clearly marked, still printable.
- **Loading** — lists and reports fetch; never leave a blank frame.

---

*Companion documents in this repo: `CONVENTIONS.md` (the API contract, error codes and the
totals formula) and `README.md` (how to run it and the demo credentials).*
