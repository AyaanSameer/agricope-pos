# Deployment & workflow

How this repo is organised, how changes reach production, and where the
backend lives. The frontend is finished against the mock API; the real
backend implements `CONVENTIONS.md` against the Postgres schema
(`docs/SCHEMA-ALIGNMENT.md`).

## 1 · Branches

- **`main`** — always releasable. Protect it on GitHub: PRs only, at least
  one review, status checks (test + build) must pass.
- **Working branches** — short-lived, one change each, deleted after merge:
  - `feature/<slug>` — new behaviour (`feature/online-ordering`)
  - `fix/<slug>` — bug fixes (`fix/receipt-rounding`)
  - `chore/<slug>` — cleanup, deps, docs (`chore/upgrade-vite`)
- **Releases** — tag `main`: `v0.1.0`, `v0.2.0`… The tag is what production
  runs; rolling back is deploying the previous tag.

```bash
git switch main && git pull
git switch -c feature/my-change
# work, commit
git push -u origin feature/my-change   # open a PR on GitHub
```

## 2 · Local workflow — test before anything ships

Day-to-day work runs entirely on the in-browser mocks; nothing you break
locally can touch a live till.

```bash
cd app
npm run dev          # http://localhost:5173 — full app on MSW mocks
```

Before every push:

```bash
npm test             # unit tests (money math, the pinned totals formula)
npm run typecheck    # strict TypeScript
npm run build        # what CI/production will run — must be clean
```

Then walk through the flows your change touches (the README has scripted
walkthroughs; mock data reseeds on every page reload). To exercise the real
API instead, put `VITE_USE_MOCKS=false` in `app/.env.local` and run the
backend locally — same commands, real data.

The path to live is always: branch → green checks locally → PR → review →
merge to `main` → staging → tag → production. Nothing deploys from a
working branch.

## 3 · First push to the organisation

Create an **empty** repo in the org (no README/license — the repo brings
its own), then:

```bash
cd "/Applications/Agricope/POS System"
git remote add origin git@github.com:<org>/agricope-pos.git
git push -u origin main
git push origin --tags
```

Then in GitHub → Settings → Branches, add the protection rule for `main`.

## 4 · CI

Add `.github/workflows/ci.yml` running on every PR: `npm ci`, `npm test`,
`npm run build` inside `app/`. Make it a required status check. (Two extra
jobs later: deploy-staging on merge to `main`, deploy-production on tag.)

## 5 · Hosting

### The database (and the API that owns it)

**`docs/GCP-SETUP.md` is the runbook** — exact commands for Cloud SQL in
`me-central1` (Doha), loading the eleven migrations, secrets, and the Cloud Run
deploy. It also states plainly what is not yet built.

The short version: Cloud SQL for PostgreSQL in `me-central1` (the only major-cloud
region inside Qatar) with the Node API on Cloud Run beside it, reaching the
database over a Unix socket so it never needs a public IP. Backups and
point-in-time recovery on from day one; one database per environment; credentials
in Secret Manager, never in the repo; migrations run by CI, never by hand in a
production console.

### The frontend

The SPA calls its API at the **relative** path `/api/v1`
(`app/src/api/client.ts`), so the simplest correct answer is to serve it from the
API service itself — same origin, no CORS, one deploy. Build it with
`VITE_USE_MOCKS=false` or it will keep answering its own calls in the browser.

## 6 · Environments

| | Data | API | Who |
|---|---|---|---|
| Local | in-memory mocks, reseeds each reload | MSW in the browser | developers |
| Staging | staging Postgres, disposable | staging deploy of `main` | the team, pilot rehearsals |
| Production | the real database | tagged release | tills |

Rule of thumb: `main` merges auto-deploy to staging; production only ever
runs a tag that ran on staging first.
