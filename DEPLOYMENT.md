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

The schema is Postgres. Two good shapes, pick by how much ops you want:

**Recommended — GCP `me-central1` (Doha):** the only major-cloud region *in
Qatar*, so tills see single-digit-ms latency.
- **Cloud SQL for PostgreSQL** — managed Postgres: automated daily backups,
  point-in-time recovery, private IP. Start on a small shared-core tier;
  resize later without schema changes.
- **Cloud Run** for the Node API next to it — scales to zero, HTTPS out of
  the box, deploys from a container built in CI.

**Simpler to start — managed-Postgres platforms:** Supabase or Neon give
you a production Postgres in minutes (backups, dashboards, connection
pooling) with the API on Railway or Render beside it. Nearest regions are
EU (~120 ms from Doha) — fine for testing and the pilot, but move to
`me-central1` before tills depend on it all day.

Non-negotiables either way:
- Automated backups **plus** point-in-time recovery turned on before the
  first real order.
- One database per environment (staging and production never share).
- Credentials only in the platform's secret manager — never in the repo.
- Migrations as files in the backend repo (e.g. `node-pg-migrate`), run by
  CI on deploy — never by hand in a production console.

### The frontend

The SPA is static files (`app/dist/`). Vercel, Netlify or Cloudflare Pages
build it on every merge (`npm run build`, publish `dist`, set
`VITE_USE_MOCKS=false`).

One wiring detail: the app calls the API at the **relative** path `/api/v1`
(`app/src/api/client.ts`), which keeps cookies/CORS trivial. Either serve
the SPA from the API service itself, or add a rewrite on the static host
proxying `/api/*` to the API's URL (all three hosts above support this).

## 6 · Environments

| | Data | API | Who |
|---|---|---|---|
| Local | in-memory mocks, reseeds each reload | MSW in the browser | developers |
| Staging | staging Postgres, disposable | staging deploy of `main` | the team, pilot rehearsals |
| Production | the real database | tagged release | tills |

Rule of thumb: `main` merges auto-deploy to staging; production only ever
runs a tag that ran on staging first.
