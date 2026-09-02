# Agricope POS — API

The REST API the frontend speaks (`../CONVENTIONS.md`), on Fastify 5 and
Postgres. It was built to the contract the in-browser mocks already
implemented, so switching the frontend from mocks to this server changes
nothing on screen.

## Run it locally

You need Node 22+ and a Postgres 14+ you can create databases on.

```bash
createdb agricope_pos               # or from psql: create database agricope_pos
cp .env.example .env                # then set JWT_SECRET and PIN_PEPPER to random values
npm install
npm run migrate                     # applies migrations/*.sql, once each
npm run seed                        # the demo world — every password is demo123
npm run dev                         # http://localhost:3000
```

Then in `../app`, put `VITE_USE_MOCKS=false` in `.env.local` and run
`npm run dev` — Vite proxies `/api` here. Same screens, real database.

`npm run seed -- --reset` wipes and reseeds. It refuses to run on a database
that already holds a business unless you pass `--reset`, so it cannot be
pointed at production by accident.

## Loading a real menu into production

The seed builds a whole fake world and must never touch production. The one
real thing inside it — Drumsticks' 65-product menu — has its own way in:

```bash
npm run import:catalogue -- --business drumsticks@agricope.qa --branch "Barwa Village"
```

Run it after the console has created the business and its branch. It adds
the categories, the three kitchen stations and the products, respects the
business's shared-or-per-branch catalogue setting, and skips anything already
there by name — so it is safe to run again.

## Test it

```bash
createdb agricope_pos_test
npm test
```

The suite migrates and seeds the test database, then drives the real app
(`app.inject`, no network) through the flows money depends on: split
payments and completion, credit limits and the ledger, discount approval by
PIN, void and refund, one open tab per table, kitchen tickets, the Z report's
expected cash, FIFO credit ageing, tenant isolation, and the
deactivate-then-delete rules. One test pins the API's money code to the
frontend's byte for byte.

## How it is put together

| | |
|---|---|
| `migrations/` | Plain SQL, applied in order by `scripts/migrate.ts`. Never edited once applied — add a new file. |
| `src/config.ts` | Every setting, validated at boot. A weak `JWT_SECRET` stops the process. |
| `src/auth.ts` | scrypt for passwords; a peppered HMAC for PINs so the till can look a person up; HS256 tokens of four kinds (admin, business, user, refresh). |
| `src/services/orders.ts` | **The order engine.** Pricing and totals for every order, using `src/lib/` — copies of the frontend's `totals.ts` and `pricing.ts`, pinned by test. Routes never compute a price. |
| `src/routes/` | One file per domain, mirroring the mock handlers they replaced. Validate with zod, authorise, call the engine, serialise. |
| `src/serialize.ts` | Row → wire. Decimal strings for money, no hashes or tenant ids leaking. |
| `scripts/seed.ts` | The demo world, built through the real engine. |
| `scripts/catalogue.ts` | Drumsticks' menu as a loader, used by the seed and by `import-catalogue.ts` for go-live. |

### Things that are deliberate

- **Money is `numeric(12,2)` and travels as a string.** `pg` is told to leave
  NUMERIC alone, so no float ever touches an amount. Arithmetic is `big.js`,
  the same library the register uses.
- **Every money write is a transaction with the order row locked.** Two tills
  settling the same tab cannot both complete it.
- **Order numbers come from a per-branch-per-day counter** bumped inside the
  order's own transaction — `S1-20260901-0042` — and the day follows
  `BUSINESS_TZ`, not the server's clock.
- **Names are snapshotted.** Orders, payments, ledger entries and shifts store
  who did them as text beside the foreign key, so deleting a login never
  blanks a receipt.
- **A branch that has sold anything cannot be deleted** — the FK is
  `on delete restrict` and the console says so. Deleting a whole business
  clears its orders deliberately first.
- **The PIN doors are rate-limited** (10/minute). Four digits are only safe if
  nobody can try ten thousand of them.
- **Deactivating a login takes effect on the next request.** Tokens are
  checked against the row, not trusted for their lifetime.

## Deploying

`../Dockerfile` builds the frontend with mocks off and packages it with this
API into one image that serves both — same origin, no CORS. It expects
`DATABASE_URL`, `JWT_SECRET` and `PIN_PEPPER` in the environment and runs the
migrations at boot. `../docs/GCP-SETUP.md` has the Cloud Run + Cloud SQL
commands.
