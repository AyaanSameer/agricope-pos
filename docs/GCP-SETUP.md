# Putting the POS on Google Cloud

Region throughout: **`me-central1` (Doha)** — the only major-cloud region inside Qatar.
Tills see single-digit-millisecond latency instead of ~120 ms to Europe.

> **Read this first.** The system is three pieces and only two of them exist:
>
> | Piece | State | Can it go up today? |
> |---|---|---|
> | Frontend (`app/`) | Built and working | Yes — but it has nothing to talk to |
> | Database (`pos-schema/`, 11 migrations) | Built and verified | **Yes** |
> | REST API between them | **Does not exist** | No |
>
> The frontend currently runs against MSW mocks *inside the browser*. There is no
> server. Deploying it to GCP today gives you the same mock app on a public URL —
> real screens, fake data, nothing persisted, and every till would see its own
> private world that vanishes on refresh.
>
> Step 1 below is real work you can do now. Step 2 is the gap. Step 3 is what
> "connected" actually looks like once step 2 is closed.

---

## Step 1 · The database (do this now)

The schema is finished and self-verifying, so it can go up before the API exists.

### 1.1 · Install the tools

Neither is on this Mac yet:

```bash
brew install --cask google-cloud-sdk && brew install postgresql@16
```

Then sign in and pick the project:

```bash
gcloud auth login && gcloud config set project YOUR_PROJECT_ID
```

### 1.2 · Turn on the APIs

```bash
gcloud services enable sqladmin.googleapis.com run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

### 1.3 · Create the instance

```bash
gcloud sql instances create agricope-pos --database-version=POSTGRES_16 --region=me-central1 --tier=db-g1-small --storage-size=20GB --storage-auto-increase --backup-start-time=22:00 --enable-point-in-time-recovery --retained-backups-count=14
```

`db-g1-small` is a shared-core tier — right for the Drumsticks pilot, cheap, and
resizable later without touching the schema. Move to `db-custom-2-7680` when more
than a couple of branches are live; shared-core tiers carry no uptime SLA.

Backups and point-in-time recovery are on from the first command deliberately.
Turning them on after the first real order is too late for the orders you already
took. Verify with `gcloud sql instances describe agricope-pos`.

### 1.4 · Set the passwords

```bash
gcloud sql users set-password postgres --instance=agricope-pos --prompt-for-password
gcloud sql databases create pos --instance=agricope-pos
```

### 1.5 · Load the schema

**Do not run `scripts/migrate.sh` against Cloud SQL** — it opens with
`dropdb --if-exists`, which is correct for a local rebuild and catastrophic on a
live database. Run the migrations directly instead.

Open the Cloud SQL Auth Proxy in one terminal:

```bash
gcloud sql instances describe agricope-pos --format='value(connectionName)'
```

```bash
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.darwin.arm64 && chmod +x cloud-sql-proxy && ./cloud-sql-proxy YOUR_CONNECTION_NAME
```

Then in a second terminal, apply the eleven migrations in order:

```bash
cd "/Users/ayaan/Documents/Agricope/POS System/pos-schema" && for f in migrations/*.sql; do echo "→ $f"; psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d pos -f "$f" || break; done
```

Migration `0011_rls.sql` creates the `pos_app` and `pos_admin` roles. Give
`pos_app` a password — it is the identity the API will connect as, deliberately
neither the table owner nor a superuser, because both bypass row-level security:

```bash
psql -h 127.0.0.1 -U postgres -d pos -c "ALTER ROLE pos_app WITH LOGIN PASSWORD 'GENERATE_A_STRONG_ONE';"
```

Store it where the API can reach it without it ever entering the repo:

```bash
printf 'THE_SAME_PASSWORD' | gcloud secrets create pos-app-db-password --data-file=- --replication-policy=user-managed --locations=me-central1
```

### 1.6 · Seed, or don't

`seed/0001_drumsticks.sql` loads the real Drumsticks menu and is what
`verify.sql` asserts against. Load it into a **staging** database to prove the
arithmetic end to end. For the production database, leave it out and let the
platform console create the tenant — production should start empty.

To prove the schema is sound before trusting it, run the full local rebuild
(`./scripts/migrate.sh` against a local Postgres, where the drop is safe). It
asserts the whole margin waterfall against hand-computed figures.

---

## Step 2 · The gap — the API does not exist

This is the piece that makes "connect it with my system" possible, and it has not
been written. Nothing about the deployment is hard; the work is the API itself.

It is not a thin wrapper, because the two halves were designed independently and
disagree. `docs/SCHEMA-ALIGNMENT.md` records the mismatches in detail. The ones
that change money:

| | Conflict |
|---|---|
| **M-01** | VAT direction is inverted. The schema extracts VAT from a tax-inclusive charge; the frontend's contract adds it on top. Both give identical answers today **only because Qatar's VAT is 0** — the day that rate becomes 5%, the two halves disagree by 5% |
| **M-02** | `order_line.qty` is an integer, but the contract sells goods by weight |
| **M-03** | Discounts sit on the order row in the contract, but the schema wants them in the `price_adjustment` ledger — the table that answers *who paid* for each reduction |
| **M-04** | Service charge is gated on order type in the contract, on channel in the schema |

Beyond those, Part 3 of that document lists twelve features the frontend already
ships that have nowhere to land in the schema — barcodes, the public receipt
token, cash tendered and change, refunds, kitchen ticket identity — and Part 4
lists six schema defects to fix before any application code is written.

**Settle those before the API is built, not after.** They are cheap decisions on
paper and expensive migrations once real orders exist.

Two honest routes:

- **Hire or assign a backend developer.** The frontend's `CONVENTIONS.md` is a
  complete API contract and the schema is done and verified, so the brief is
  unusually well specified — but it is still weeks of work, not days.
- **Have me build it.** A Node + TypeScript API implementing `CONVENTIONS.md`
  against these migrations is a large but tractable project. It would start with
  the four money conflicts, since every endpoint downstream depends on which way
  they get settled.

---

## Step 3 · Deploying once the API exists

### The shape I recommend

**One Cloud Run service that serves both the API and the built frontend.**

The frontend calls its API at the relative path `/api/v1` — see
`app/src/api/client.ts`. Serving both from one origin means no CORS, no proxy
rules, no cookie-domain problems, and one deploy instead of two. Given that the
whole product is a handful of tills, splitting them across a CDN buys nothing and
costs a class of bugs.

That points at a **monorepo**: add `api/` beside the existing `app/` in this
repo. The container build then runs `npm run build` in `app/` and copies
`app/dist/` into the API image, which serves it as static files with a catch-all
route back to `index.html` for the SPA router.

```
Agricope POS System/
├── app/          the React SPA (exists)
├── api/          the Node REST API (to build)
├── db/           the migrations (move pos-schema/ in here)
└── Dockerfile    builds app/ then packages it with api/
```

### The deploy

Build and push:

```bash
gcloud builds submit --tag me-central1-docker.pkg.dev/YOUR_PROJECT_ID/agricope/pos:v0.1.0
```

Deploy, wiring the database and the secret in:

```bash
gcloud run deploy agricope-pos --image=me-central1-docker.pkg.dev/YOUR_PROJECT_ID/agricope/pos:v0.1.0 --region=me-central1 --add-cloudsql-instances=YOUR_CONNECTION_NAME --set-secrets=DB_PASSWORD=pos-app-db-password:latest --set-env-vars=DB_USER=pos_app,DB_NAME=pos,DB_HOST=/cloudsql/YOUR_CONNECTION_NAME --min-instances=1 --allow-unauthenticated
```

Two flags worth understanding:

- `--add-cloudsql-instances` mounts a Unix socket at
  `/cloudsql/CONNECTION_NAME`, so the API reaches Postgres over Google's internal
  network. The database never needs a public IP.
- `--min-instances=1` keeps one container warm. Cloud Run scales to zero by
  default, which is excellent for cost and wrong for a till — the first sale
  after a quiet spell would wait several seconds for a cold start plus a database
  connection.

### The one build flag that connects it

The frontend must be built with mocks off, or it will keep answering its own API
calls in the browser and never contact your server:

```bash
VITE_USE_MOCKS=false npm run build
```

`app/src/main.tsx` reads this at build time; anything other than the exact string
`false` leaves the mock worker running. Put it in the Dockerfile's build stage,
not in a local `.env` file, so a production image can never be built with mocks
on by accident.

---

## What this costs, roughly

Cloud Run scales to near-nothing at POS traffic; `--min-instances=1` is the main
line item there. Cloud SQL on `db-g1-small` with 20 GB is the larger and steadier
cost. Both are modest for a pilot — well under what a POS vendor licence would
be — but confirm current figures against the
[GCP pricing calculator](https://cloud.google.com/products/calculator) for
`me-central1` rather than trusting a number written here, since regional pricing
moves.

---

## Before real money runs through it

- **Offline behaviour.** A cloud POS stops selling when the branch's internet
  drops. The schema README lists offline sync as deliberately not built yet, with
  `order_event` as the seam for it. Decide what a till does during an outage
  *before* a Friday dinner service answers the question for you.
- **Staging first.** A second, smaller Cloud SQL instance and a second Cloud Run
  service. Production should only ever run a tag that ran on staging.
- **Restore drills.** Backups you have never restored are a hypothesis. Restore
  to a throwaway instance once and time it.
- **No secrets in the repo.** Every credential above lives in Secret Manager and
  reaches the container as an environment variable at run time.
