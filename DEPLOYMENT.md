# Going live — the order of operations

Six steps, in the order they have to happen. Each one says what you are doing
and why, and points at the exact commands where there are many. Read this
first; `docs/GCP-SETUP.md` is the command sheet it refers to.

**The one idea that makes all of it work:** the code never contains the
database's address. The API reads `DATABASE_URL` from its environment when it
starts — from `api/.env` on your Mac, from a secret on the server. Same code,
different environment. That is how the deployed system is "connected" to the
Neon database while your laptop keeps testing against its own.

---

## 1 · Test locally, before anything ships

Two modes, and you will use both.

**Mocks — no database, nothing to break.** The whole app runs against an
in-browser copy of the API. Data resets on every reload. This is the default,
and it is what the public demo runs.

```bash
cd "/Applications/Agricope/POS System/app" && npm run dev
```

**Real database — the full system on your machine.** Postgres.app on this Mac
already holds a seeded `agricope_pos`. Two terminals:

```bash
cd "/Applications/Agricope/POS System/api" && npm run dev
```

```bash
cd "/Applications/Agricope/POS System/app" && echo 'VITE_USE_MOCKS=false' > .env.local && npm run dev
```

Open http://localhost:5173 either way. Delete `app/.env.local` to return to
mocks. Reset the local database any time with `npm run seed -- --reset` in
`api/`.

Before every push, both suites and both builds:

```bash
cd "/Applications/Agricope/POS System/app" && npm test && npm run build
```

```bash
cd "/Applications/Agricope/POS System/api" && npm run typecheck && npm test
```

The API suite runs the real server against a real Postgres — 45 tests over
every flow money depends on. CI runs exactly these on every push.

## 2 · Move the repository to the organisation

Create an **empty** repository in the organisation (no README, no licence —
the repo brings its own), then point this clone at it. The old personal
remote stays reachable as `personal` in case you want it.

```bash
cd "/Applications/Agricope/POS System" && git remote rename origin personal && git remote add origin git@github.com:YOUR-ORG/agricope-pos.git && git push -u origin main
```

Then on GitHub: **Settings → Branches → protect `main`** — require a pull
request, and require the `CI` checks to pass.

**Public or private?** GitHub Pages will not publish from a private repository
without a paid plan. If the organisation repo is private, the demo workflow's
publish step fails (the build still passes); either delete
`.github/workflows/deploy-demo.yml`, or keep the public personal repo as the
demo host. If it is public, the demo moves to
`https://YOUR-ORG.github.io/agricope-pos/` on the next push — update the link
in `docs/DEMO.md`.

## 3 · Create the database — on Neon

There is no database file that *has* to be uploaded. You create a Postgres on
Neon, and either let **the API create the schema the first time it starts**
(`api/migrations/` applied once each, recorded in `schema_migrations`) or copy
your local database up as-is. Both are below.

**Create the project.** In the Neon console: new project, Postgres **17**,
region **Frankfurt (aws-eu-central-1)** — Neon has no Middle East region and
Frankfurt is the nearest. Then copy the connection string from the project's
*Connect* panel, choosing the **direct** connection, not the *pooled* one (the
API keeps its own pool, and a direct connection is the one migrations need).
It looks like:

```
postgres://neondb_owner:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

Change the SSL parameters to these two, and use the result everywhere:

```
?sslmode=verify-full&sslrootcert=system
```

`verify-full` is the check the API's driver performs anyway, and spelling it
out stops the driver printing a deprecation warning at every boot.
`sslrootcert=system` is for `psql` and `pg_dump`: they refuse `verify-full`
without a root certificate and look for one at `~/.postgresql/root.crt`, which
does not exist on a normal Mac. Pointing them at the operating system's trust
store is enough, because Neon's certificate comes from Let's Encrypt.

The API strips that one parameter before handing the string to its driver,
which reads `sslrootcert` as a file path and would otherwise open a file
called "system" and die at boot. That is deliberate, so one string can live in
the secret manager instead of two that drift apart.

Keep the string somewhere safe. It is the database password.

**Fill it, one of two ways.**

*A — clean, for production.* Create the schema, then the first
administrator, and go on to step 5 for the business and its menu:

```bash
cd "/Applications/Agricope/POS System/api" && DATABASE_URL='<neon url>' npm run migrate
```

*B — copy your local database up, for a shared test copy.* Everything on
your Mac's `agricope_pos` — the three demo tenants, their `demo123` logins,
the fake orders — lands on Neon as it is. Fine for a staging copy the team can
try; not what production should start from.

```bash
/Applications/Postgres.app/Contents/Versions/18/bin/pg_dump -h localhost --no-owner --no-privileges agricope_pos | /Applications/Postgres.app/Contents/Versions/18/bin/psql -v ON_ERROR_STOP=1 '<neon url>'
```

The dump carries `schema_migrations`, so the API finds nothing to apply and
starts straight on the copied data. (Rehearsed locally: the dump restores in
full into an empty database.)

**Two things about Neon worth knowing.**

- **It suspends when quiet.** On the free plan the compute stops after five
  idle minutes; the first query after that waits about a second while it
  wakes, and every idle connection is dropped. The API handles the drop and
  gives the wake-up long enough. For production, turn auto-suspend off in the
  project's compute settings (a paid-plan option) so the first sale after a
  lull never waits.
- **Branches are the local-testing answer.** In the Neon console, create a
  branch called `dev` from `main`. Put *its* connection string in `api/.env`
  on your Mac and you are testing against a real cloud copy that cannot
  touch production; reset the branch from `main` whenever you want it fresh.
  Your local Postgres.app keeps working exactly as before if you would rather
  stay offline.

`docs/GCP-SETUP.md` §2 still has the Cloud SQL commands if you ever want the
database inside Qatar instead.

## 4 · Deploy the code, connected to it

The root `Dockerfile` builds the frontend with mocks off and packages it with
the API into one image; the API serves both, so `/api/v1` is same-origin and
needs no CORS.

The connection is three secrets — `DATABASE_URL` (the Neon string),
`JWT_SECRET`, `PIN_PEPPER` — that the host injects into the container's
environment. They never enter the repository. `docs/GCP-SETUP.md` §3–4 has
the Cloud Run commands: create the secrets, build the image, deploy with
`--set-secrets`.

**Put the API next to the database.** Deploy Cloud Run in `europe-west3`
(Frankfurt), the same city as the Neon project. Then the API talks to
Postgres inside one datacentre, and a till in Doha pays one ~100 ms hop per
action — fine. The other way round (API in Doha, database in Frankfurt) makes
every order pay that hop several times over.

The URL Cloud Run prints is the whole product: login, the tills, the console,
the API, one origin.

## 5 · The first administrator, the first business, the real menu

A fresh production database has no platform administrator, so nobody can open
the console yet. Both scripts take the Neon connection string directly — no
proxy, no tunnel:

```bash
cd "/Applications/Agricope/POS System/api" && DATABASE_URL='<neon url>' npm run create:admin -- --name "Agricope Admin" --email admin@agricope.qa --password 'A-STRONG-ONE'
```

Sign in to the console with that, create Drumsticks, its branch, and its
owner login. Then load their real 65-product menu — the one thing the demo
seed contains that production actually needs:

```bash
cd "/Applications/Agricope/POS System/api" && DATABASE_URL='<neon url>' npm run import:catalogue -- --business drumsticks@agricope.qa --branch "Barwa Village"
```

It adds categories, the three kitchen stations and the products, honours the
business's shared-or-per-branch catalogue setting, and skips anything already
there by name — so running it twice adds nothing. Change the admin password
from the console after the first sign-in.

**Never `npm run seed` against this database.** It writes three fake
businesses whose every password is `demo123`, and with `--reset` it deletes
what is there first. The script now refuses any host that is not on your
machine unless you type that host after `--wipe-remote`, so the accident takes
a deliberate act. Do not make that act.

## 6 · Day to day

- **Work on a branch:** `feature/<slug>`, `fix/<slug>`, `chore/<slug>`. One
  change each, deleted after merge.
- **Open a pull request.** CI runs both suites and both builds; `main` is
  protected, so nothing lands red.
- **Release by tag.** `v0.1.0`, `v0.1.1`… Build the image with that tag,
  deploy that tag. Rolling back is deploying the previous one.
- **Staging first:** a Neon branch and a second Cloud Run service deployed
  from `main`. Production only ever runs a tag that ran on staging.

| | Data | API | Who |
|---|---|---|---|
| Local | in-memory mocks, your Postgres, or a Neon `dev` branch | MSW in the browser, or `npm run dev` | you |
| Staging | a Neon branch or a copy of local, disposable | `main` | the team, pilot rehearsals |
| Production | the real database | tagged release | tills |
