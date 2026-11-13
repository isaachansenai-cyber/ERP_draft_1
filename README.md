# Meats Around the World ERP (MVP pilot)

This is an internal restaurant ERP for three locations: Provo, Spanish Fork and Salt Lake City. It covers the staff POS, kitchen and pickup, recipe-based inventory, purchasing, supplier invoices, planning (MRP/EOQ), schedules and reporting. The frontend is React, TypeScript and Vite, hosted as a static site on GitHub Pages. The backend is Supabase Auth, Postgres, row-level security and transactional RPC functions.

- Build instructions for the coding agent: [`CLAUDE.md`](CLAUDE.md)
- Product specification: [`docs/spec/ERP_MVP_PRD.txt`](docs/spec/ERP_MVP_PRD.txt)
- Launch checks with current status and evidence: [`docs/acceptance/Acceptance_Checklist.csv`](docs/acceptance/Acceptance_Checklist.csv)
- Progress notes: [`docs/acceptance/PROGRESS.md`](docs/acceptance/PROGRESS.md)
- Decisions not covered by the PRD: [`docs/decisions/`](docs/decisions/)

## Status

**Milestone 1 (Foundation) is complete.** It includes:

- versioned SQL migrations and row-level security
- Auth with server-resolved roles and location access
- pilot/demo data separation, including the pilot setup gates
- the idempotent source-master importer, plus guarded demo seed and history importers
- demo-user tooling
- the app shell: sign-in, location selector, data-mode banner, and the settings screens for setup gates, taxes and prices, staff access and the manager PIN

POS, kitchen, inventory and the other modules arrive in Milestones 2–5. They are not shown in the app until they work end to end.

## Prerequisites

- Node.js 20 or later, with npm
- Docker, for the local Supabase stack
- If `public.ecr.aws` is blocked on your network, set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` before running any `supabase` command. The CLI then pulls the same images from Docker Hub.

## Local development (pilot mode)

```bash
npm ci
npm run db:start          # local Supabase stack (Postgres, Auth, REST)
npm run db:reset          # apply all migrations; a fresh database is in PILOT mode
npx supabase status       # shows the local API URL and keys
```

Create a gitignored `.env.local` for the frontend and the operator tooling:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
VITE_BASE_PATH=/
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:54322/postgres
```

Import the source master data. It is insert-only and idempotent, and allowed in both pilot and demo databases:

```bash
DATABASE_URL=... npm run import:source
```

Create the first owner. Invite or create the Auth user first (Supabase Studio or the Auth admin API), then run this once as the database owner:

```sql
select private.bootstrap_owner('owner@yourdomain.example', 'Owner Name');
```

Start the app:

```bash
npm run dev               # http://127.0.0.1:5173
```

The full pilot setup runbook is [`docs/ops/pilot-setup.md`](docs/ops/pilot-setup.md).

## Demo database

The demo must be a **separate** Supabase project, or the disposable local stack. Every demo tool refuses unless both of these hold: the project ref is in `DEMO_PROJECT_REF_ALLOWLIST`, and the database reports demo mode. See [`docs/demo/README.md`](docs/demo/README.md).

## Tests

| Command | What it proves |
|---|---|
| `npm run typecheck` / `npm run lint` | Strict TypeScript, ESLint |
| `npm run test:unit` | Money/rate formatting, error classification, request-key retry logic, tooling guards, secret scanner |
| `npm run test:db` | Resets the local DB, then runs the pgTAP database invariants (RLS, grants, immutability, synthetic-data guards, recipes, unit conversion, gates, idempotency, PIN lockout, demo-mode switch) |
| `npm run test:integration` | Real API tests as local Auth users: a pilot suite (AC01, AC02 pilot side, AC03, retries, gates), then a demo suite (AC02 demo side, AC34, demo logins, reset reproducibility) |
| `npm run test:e2e` | Production build under `/ERP_draft_1/`: hash deep-link refresh, sign-in, role-scoped UI, offline and lost-response handling |
| `npm run build && npm run test:secrets -- --require-dist` | AC30 secret scan of the repository and the production bundle |

The integration and e2e suites **reset the local database**. They refuse to run against anything but `127.0.0.1`/`localhost`.

## Build and GitHub Pages

```bash
VITE_BASE_PATH=/ERP_draft_1/ VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build
```

- The output is in `dist/`.
- The app uses hash routing (`/#/settings/setup`), so refreshes and deep links work without server rewrites.
- Only the project URL and the publishable/anon key are ever bundled.

Deployment is an operator action. It has not been performed by this build: see [`docs/ops/deployment.md`](docs/ops/deployment.md).

## Repository layout

```
supabase/migrations/   versioned SQL (0001–0008 in Milestone 1)
supabase/tests/        pgTAP tests
scripts/import/        source-master, demo-seed, demo-history importers
scripts/demo/          init-demo-database, create-demo-users, reset-demo (allowlist + demo-mode guarded)
scripts/security/      AC30 secret scanner
src/                   React app
tests/unit|integration|e2e
data/source/           source-only master data (pilot + demo)
data/demo/             synthetic demo fixtures and history (demo only)
docs/                  spec, acceptance, ops, demo, decisions
```

## Security notes

- The browser is untrusted. All writes go through `SECURITY DEFINER` RPCs that authorize `auth.uid()` themselves. API roles have no INSERT, UPDATE or DELETE privilege on any table.
- Never commit `.env*` (except `.env.example`), `DEMO_CREDENTIALS.local.md`, database dumps, `exports/` or `pilot-data/`. The secret scan fails if you do.
- No payment gateway, card or bank integration exists. Tenders and refunds are records of something handled outside the app.
