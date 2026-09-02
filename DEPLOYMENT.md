# Going live — the order of operations

Six steps, in the order they have to happen. Each one says what you are doing
and why, and points at the exact commands where there are many. Read this
first; `docs/GCP-SETUP.md` is the command sheet it refers to.

**The one idea that makes all of it work:** the code never contains the
database's address. The API reads `DATABASE_URL` from its environment when it
starts — from `api/.env` on your Mac, from a secret on the server. Same code,
different environment. That is how the deployed system is "connected" to the
uploaded database while your laptop keeps testing against its own.

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

## 3 · Create the database

There is no database file to upload. You create a Postgres server in the
cloud, and **the API creates the schema in it the first time it starts** —
`api/migrations/` applied once each, recorded in `schema_migrations`. The
database starts empty on purpose: the demo seed is fake, and production gets
its first business from the console.

`docs/GCP-SETUP.md` §2 has the commands for Cloud SQL in `me-central1` (Doha —
single-digit-millisecond latency for the tills). Backups and point-in-time
recovery are turned on in the creation command, before the first order, which
is the only time that is not too late.

## 4 · Deploy the code, connected to it

The root `Dockerfile` builds the frontend with mocks off and packages it with
the API into one image; the API serves both, so `/api/v1` is same-origin and
needs no CORS. Cloud Run runs that image next to the database, reaching it
over a private socket.

The connection is three secrets — `DATABASE_URL`, `JWT_SECRET`, `PIN_PEPPER`
— that Cloud Run injects into the container's environment. They never enter
the repository. `docs/GCP-SETUP.md` §3–4 has the commands: create the
secrets, build the image, deploy with `--set-secrets`.

The URL Cloud Run prints is the whole product: login, the tills, the console,
the API, one origin.

## 5 · The first administrator, the first business, the real menu

A fresh production database has no platform administrator, so nobody can open
the console yet. Through the Cloud SQL Auth Proxy (`GCP-SETUP.md` §5):

```bash
cd "/Applications/Agricope/POS System/api" && DATABASE_URL='<proxy url>' npm run create:admin -- --name "Agricope Admin" --email admin@agricope.qa --password 'A-STRONG-ONE'
```

Sign in to the console with that, create Drumsticks, its branch, and its
owner login. Then load their real 65-product menu — the one thing the demo
seed contains that production actually needs:

```bash
cd "/Applications/Agricope/POS System/api" && DATABASE_URL='<proxy url>' npm run import:catalogue -- --business drumsticks@agricope.qa --branch "Barwa Village"
```

It adds categories, the three kitchen stations and the products, honours the
business's shared-or-per-branch catalogue setting, and skips anything already
there by name — so running it twice adds nothing. Change the admin password
from the console after the first sign-in.

## 6 · Day to day

- **Work on a branch:** `feature/<slug>`, `fix/<slug>`, `chore/<slug>`. One
  change each, deleted after merge.
- **Open a pull request.** CI runs both suites and both builds; `main` is
  protected, so nothing lands red.
- **Release by tag.** `v0.1.0`, `v0.1.1`… Build the image with that tag,
  deploy that tag. Rolling back is deploying the previous one.
- **Staging first**, once you can afford it: a second, smaller Cloud SQL
  instance and a second Cloud Run service deployed from `main`. Production
  only ever runs a tag that ran on staging.

| | Data | API | Who |
|---|---|---|---|
| Local | in-memory mocks, or your Postgres | MSW in the browser, or `npm run dev` | you |
| Staging | staging Postgres, disposable | `main` | the team, pilot rehearsals |
| Production | the real database | tagged release | tills |
