# Google Cloud — the command sheet

The commands `DEPLOYMENT.md` points at, in the same order. Region throughout:
**`me-central1` (Doha)**, the only major-cloud region inside Qatar.

Replace `YOUR_PROJECT_ID` throughout. Every command is one line so it can be
pasted as-is.

---

## 1 · Tools and project

```bash
brew install --cask google-cloud-sdk
```

```bash
gcloud auth login && gcloud config set project YOUR_PROJECT_ID
```

```bash
gcloud services enable sqladmin.googleapis.com run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

## 2 · The database — only if it is not on Neon

**Using Neon (the default in `DEPLOYMENT.md` §3)? Skip this section.** Your
`DATABASE_URL` is the string Neon shows, and nothing here is needed.
The rest of this section creates a Postgres inside Qatar on Cloud SQL instead.

```bash
gcloud sql instances create agricope-pos --database-version=POSTGRES_16 --region=me-central1 --tier=db-g1-small --storage-size=20GB --storage-auto-increase --backup-start-time=22:00 --enable-point-in-time-recovery --retained-backups-count=14
```

`db-g1-small` is a shared-core tier — right for the pilot and resizable later
without touching the schema. Move to `db-custom-2-7680` when several branches
are live; shared-core tiers carry no uptime SLA.

```bash
gcloud sql users set-password postgres --instance=agricope-pos --prompt-for-password
```

```bash
gcloud sql databases create pos --instance=agricope-pos
```

A dedicated login for the API, rather than handing it `postgres`:

```bash
gcloud sql users create pos_app --instance=agricope-pos --prompt-for-password
```

Note the instance's connection name — it appears in the next two steps:

```bash
gcloud sql instances describe agricope-pos --format='value(connectionName)'
```

Nothing is loaded by hand. The API creates the schema on first boot.

## 3 · Secrets

Three values, none of which may ever appear in the repository. The whole
connection string is one secret, so no password is ever spelled out in a
deploy command or a shell history.

With Neon, the value is the connection string from `DEPLOYMENT.md` §3,
both SSL parameters included:

```bash
printf 'postgres://neondb_owner:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full&sslrootcert=system' | gcloud secrets create pos-database-url --data-file=- --replication-policy=user-managed --locations=europe-west3
```

With Cloud SQL it is the socket form instead:

```bash
printf 'postgres://pos_app:THE_POS_APP_PASSWORD@/pos?host=/cloudsql/CONNECTION_NAME' | gcloud secrets create pos-database-url --data-file=- --replication-policy=user-managed --locations=me-central1
```

```bash
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" | gcloud secrets create pos-jwt-secret --data-file=- --replication-policy=user-managed --locations=REGION
```

```bash
node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64'))" | gcloud secrets create pos-pin-pepper --data-file=- --replication-policy=user-managed --locations=REGION
```

`REGION` is wherever the API will run: `europe-west3` beside a Neon project
in Frankfurt, `me-central1` beside Cloud SQL in Doha.

The pepper is keyed into every PIN hash. **Losing or rotating it invalidates
every PIN on the platform** — keep a copy somewhere other than Secret Manager.

## 4 · Build and deploy

An Artifact Registry repository, once:

```bash
gcloud artifacts repositories create agricope --repository-format=docker --location=REGION
```

Build the image from the repository root and push it:

```bash
cd "/Applications/Agricope/POS System" && gcloud builds submit --tag REGION-docker.pkg.dev/YOUR_PROJECT_ID/agricope/pos:v0.1.0
```

Deploy it next to the database, with the three secrets injected. **With
Neon** (API in Frankfurt, same city as the database):

```bash
gcloud run deploy agricope-pos --image=europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/agricope/pos:v0.1.0 --region=europe-west3 --set-secrets=DATABASE_URL=pos-database-url:latest,JWT_SECRET=pos-jwt-secret:latest,PIN_PEPPER=pos-pin-pepper:latest --set-env-vars=BUSINESS_TZ=Asia/Qatar --min-instances=1 --max-instances=1 --allow-unauthenticated
```

**With Cloud SQL** in Doha, the same plus the socket mount:

```bash
gcloud run deploy agricope-pos --image=me-central1-docker.pkg.dev/YOUR_PROJECT_ID/agricope/pos:v0.1.0 --region=me-central1 --add-cloudsql-instances=CONNECTION_NAME --set-secrets=DATABASE_URL=pos-database-url:latest,JWT_SECRET=pos-jwt-secret:latest,PIN_PEPPER=pos-pin-pepper:latest --set-env-vars=BUSINESS_TZ=Asia/Qatar --min-instances=1 --max-instances=1 --allow-unauthenticated
```

Flags worth understanding:

- `--add-cloudsql-instances` mounts a Unix socket at `/cloudsql/CONNECTION_NAME`,
  so the API reaches Cloud SQL over Google's internal network and the database
  never needs a public IP. Neon is reached over TLS on the internet, which is
  why its string carries `sslmode=verify-full`.
- `--min-instances=1` keeps one container warm. Cloud Run scales to zero by
  default — right for cost, wrong for a till, which would wait seconds for a
  cold start on the first sale after a quiet spell. `--max-instances=1` for
  now: migrations run at boot, and two instances starting together must not
  race. Raise it once migrations move to a release step (§6).

The service URL Cloud Run prints is the whole product on one origin.

## 5 · The first administrator and the real menu

**With Neon,** both scripts take the connection string directly — see
`DEPLOYMENT.md` §5; nothing below is needed.

**With Cloud SQL,** they reach the database through the Cloud SQL Auth
Proxy, which makes it reachable on your Mac as `localhost:5432` without a
public IP.

```bash
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.darwin.arm64 && chmod +x cloud-sql-proxy && ./cloud-sql-proxy CONNECTION_NAME
```

In a second terminal, with the proxy running:

```bash
cd "/Applications/Agricope/POS System/api" && DATABASE_URL='postgres://pos_app:THE_POS_APP_PASSWORD@127.0.0.1:5432/pos' npm run create:admin -- --name "Agricope Admin" --email admin@agricope.qa --password 'A-STRONG-ONE'
```

Sign in to the console, create the business, its branch and its owner login.
Then load the menu:

```bash
cd "/Applications/Agricope/POS System/api" && DATABASE_URL='postgres://pos_app:THE_POS_APP_PASSWORD@127.0.0.1:5432/pos' npm run import:catalogue -- --business drumsticks@agricope.qa --branch "Barwa Village"
```

Stop the proxy when done. **Never run `npm run seed` against this database.**
It refuses a non-local host unless you type that host after `--wipe-remote`,
and refuses a database that already holds a business unless you pass
`--reset`. Both are seatbelts, not permission.

## 6 · Releases

- Tag `main` (`v0.1.0`, `v0.1.1`…); build with that tag; deploy that tag.
  Rolling back is deploying the previous one.
- One database per environment — a Neon branch, or a second Cloud SQL
  instance. A staging service deployed from `main` catches problems before a
  tag reaches production.
- When you raise `--max-instances` above one, run
  `node dist/scripts/migrate.js` as a release step before the rollout and
  drop the migrate-at-boot from the `Dockerfile`'s `CMD`.

## 7 · What it costs, roughly

Cloud Run with one warm instance is a few dollars a month at POS traffic.
Neon's free plan covers a pilot; auto-suspend off and a bigger compute are
the Launch plan. Cloud SQL on `db-g1-small` with 20 GB is the steadier line
item if the database must sit in Qatar. Confirm current figures on the
[pricing calculator](https://cloud.google.com/products/calculator) rather
than trusting a number written here.

## 8 · Before real money runs through it

- **Offline behaviour.** A cloud POS stops selling when the branch's internet
  drops. Decide what a till does during an outage before a Friday dinner
  service decides for you.
- **Restore drills.** Backups you have never restored are a hypothesis.
  Restore to a throwaway instance once and time it.
- **Rotate the console password** from the console's own *Change password*
  after the first sign-in, and the `pos_app` database password if it ever
  appeared in a terminal.
