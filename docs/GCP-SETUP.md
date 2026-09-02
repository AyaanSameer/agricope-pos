# Putting the POS on Google Cloud

Region throughout: **`me-central1` (Doha)** — the only major-cloud region inside Qatar.
Tills see single-digit-millisecond latency instead of ~120 ms to Europe.

What ships is one container (the root `Dockerfile`): the API serving the built
frontend from the same origin, talking to a Cloud SQL Postgres over a private
socket. The API applies its own migrations at boot, so a fresh database needs
nothing loaded by hand.

---

## 1 · Tools and project

Neither tool is on the Mac yet:

```bash
brew install --cask google-cloud-sdk && brew install postgresql@16
```

```bash
gcloud auth login && gcloud config set project YOUR_PROJECT_ID
```

```bash
gcloud services enable sqladmin.googleapis.com run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

## 2 · The database

```bash
gcloud sql instances create agricope-pos --database-version=POSTGRES_16 --region=me-central1 --tier=db-g1-small --storage-size=20GB --storage-auto-increase --backup-start-time=22:00 --enable-point-in-time-recovery --retained-backups-count=14
```

`db-g1-small` is a shared-core tier — right for the pilot, cheap, resizable
later without touching the schema; move to `db-custom-2-7680` when several
branches are live, since shared-core tiers carry no uptime SLA. Backups and
point-in-time recovery are on from the first command deliberately: turning
them on after the first real order is too late for the orders already taken.

```bash
gcloud sql users set-password postgres --instance=agricope-pos --prompt-for-password
```

```bash
gcloud sql databases create pos --instance=agricope-pos
```

Create a dedicated login for the API rather than handing it `postgres`:

```bash
gcloud sql users create pos_app --instance=agricope-pos --prompt-for-password
```

The schema itself is created by the API at first boot (`api/migrations/`,
applied once each and recorded in `schema_migrations`). Do not run the seed
against this database — production starts empty and the console creates the
first business.

## 3 · Secrets

Three values, none of which may ever appear in the repo:

```bash
printf 'THE_POS_APP_PASSWORD' | gcloud secrets create pos-db-password --data-file=- --replication-policy=user-managed --locations=me-central1
```

```bash
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))" | gcloud secrets create pos-jwt-secret --data-file=- --replication-policy=user-managed --locations=me-central1
```

```bash
node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64'))" | gcloud secrets create pos-pin-pepper --data-file=- --replication-policy=user-managed --locations=me-central1
```

The pepper is keyed into every PIN hash. **Losing or rotating it invalidates
every PIN on the platform** — back it up somewhere other than Secret Manager
as well.

## 4 · Build and deploy

An Artifact Registry repository, once:

```bash
gcloud artifacts repositories create agricope --repository-format=docker --location=me-central1
```

Build the image from the repo root and push it:

```bash
gcloud builds submit --tag me-central1-docker.pkg.dev/YOUR_PROJECT_ID/agricope/pos:v0.1.0
```

Find the instance's connection name, then deploy:

```bash
gcloud sql instances describe agricope-pos --format='value(connectionName)'
```

```bash
gcloud run deploy agricope-pos --image=me-central1-docker.pkg.dev/YOUR_PROJECT_ID/agricope/pos:v0.1.0 --region=me-central1 --add-cloudsql-instances=CONNECTION_NAME --set-secrets=DB_PASSWORD=pos-db-password:latest,JWT_SECRET=pos-jwt-secret:latest,PIN_PEPPER=pos-pin-pepper:latest --set-env-vars='DATABASE_URL=postgres://pos_app:$(DB_PASSWORD)@/pos?host=/cloudsql/CONNECTION_NAME,BUSINESS_TZ=Asia/Qatar' --min-instances=1 --max-instances=3 --allow-unauthenticated
```

If your shell expands `$(DB_PASSWORD)`, set `DATABASE_URL` from the Cloud Run
console instead, or build it in a startup wrapper — the point is that the
password reaches the process only through Secret Manager.

Two flags worth understanding:

- `--add-cloudsql-instances` mounts a Unix socket at `/cloudsql/CONNECTION_NAME`
  so the API reaches Postgres over Google's internal network. The database
  never needs a public IP.
- `--min-instances=1` keeps one container warm. Cloud Run scales to zero by
  default, which is right for cost and wrong for a till — the first sale after
  a quiet spell would wait several seconds for a cold start.

The service URL Cloud Run prints is the whole product: the login page, the
tills, the console and `/api/v1` on one origin.

### Creating the first business

Production has no platform admin until one exists. Insert it once, through the
Cloud SQL Auth Proxy, with a password hash the API recognises:

```bash
cd api && node -e "import('./dist/src/auth.js').then(async a => console.log(await a.hashPassword(process.argv[1])))" 'A-STRONG-CONSOLE-PASSWORD'
```

```sql
insert into platform_admins (name, email, password_hash) values ('Agricope Admin', 'admin@agricope.qa', '<the hash>');
```

From then on everything happens in the console: add the business, its
branches, its first owner.

## 5 · Releases

- Tag `main` (`v0.1.0`, `v0.1.1`…); build the image with that tag; deploy that
  tag. Rolling back is deploying the previous tag.
- One Cloud SQL instance per environment. A staging instance and a staging
  Cloud Run service, deployed from `main`, catch problems before a tag goes to
  production.
- Migrations run at boot today, which is right for one instance. Once
  `--max-instances` is above one, run `node dist/scripts/migrate.js` as a
  release step before the rollout so two starting instances never race.

## 6 · What this costs, roughly

Cloud Run at POS traffic is a few dollars a month with one warm instance.
Cloud SQL on `db-g1-small` with 20 GB is the steadier line item. Both are
modest for a pilot; confirm current figures for `me-central1` on the
[pricing calculator](https://cloud.google.com/products/calculator) rather
than trusting a number written here.

## 7 · Before real money runs through it

- **Offline behaviour.** A cloud POS stops selling when the branch's internet
  drops. Decide what a till does during an outage before a Friday dinner
  service decides for you.
- **Restore drills.** Backups you have never restored are a hypothesis.
  Restore to a throwaway instance once and time it.
- **Rotate the console password** you inserted above the first time you sign
  in, from the console's own *Change password*.
