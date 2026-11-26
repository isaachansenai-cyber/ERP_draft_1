# Deployment (GitHub Pages + Supabase)

Deployment is an **operator action**.

Current state (2026-11-25):

- The **demo** is live. The Supabase project `qfvtpgxguaftrprxprof` is in demo mode with the demo data imported and the demo logins created by **Actions → Demo project setup**, last run on 2026-11-14. It therefore has migrations up to `0022` only.
- The Pages site `https://isaachansenai-cyber.github.io/ERP_draft_1/` serves the 2026-11-18 build, which needs migration `0023`. That mismatch is why waste reports and item charts fail on the hosted demo (ADR 0036). Re-running Demo project setup applies the missing migrations; it also issues new demo passwords.
- No pilot project exists yet.

There are always two separate Supabase projects: a resettable **demo** and an isolated **pilot**. A frontend setting is never the isolation boundary. Each gets its own build.

## 1. Supabase projects (operator)

1. Create the project in the Supabase dashboard (US region close to Utah).
2. Auth settings:
   - disable self sign-up (the app has no sign-up screen; staff are invited);
   - set the Site URL and Redirect URLs to the Pages URL (`https://<user>.github.io/<repo>/`).
3. Apply the migrations from a trusted machine:

   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

   A new database starts in **pilot mode** with posting disabled and every setup gate open.

4. Open **Advisors → Security** in the dashboard and confirm there are no findings. Locally the schema passes `supabase db lint --level warning` with none.
5. Demo project only: follow [`../demo/README.md`](../demo/README.md) (switch to demo mode, import the demo data, create demo logins).
6. Pilot project only: follow [`pilot-setup.md`](pilot-setup.md). Never set `DEMO_PROJECT_REF_ALLOWLIST` to the pilot's ref.

## 2. Frontend on GitHub Pages

The app is a static site with hash routing (`#/pos`), so refreshes and deep links work without server rewrites. Vite's `base` comes from `VITE_BASE_PATH`.

### Using the included workflow (recommended)

`.github/workflows/pages.yml` runs only when started by hand (**Actions → Deploy to GitHub Pages → Run workflow**, then choose `demo` or `pilot`).

1. **Settings → Pages:** set the source to "GitHub Actions".
2. **Settings → Environments:** create `demo` and `pilot`, each with two **variables** (not secrets; both values are public by design):
   - `VITE_SUPABASE_URL`: `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY`: that project's publishable/anon key
3. Run the workflow. It builds under `/<repo>/` and runs the secret scan (`npm run test:secrets -- --require-dist`), which fails the deployment if the bundle contains a service-role key, a secret key, a database URL or `service_role`. Then it publishes.

One Pages site can host one build at a time. For both a demo and a pilot site, use a second repository (or a fork) for the demo, or host one of them elsewhere. Publish the pilot build only after the go-live checklist in `pilot-setup.md`.

### By hand

```bash
VITE_BASE_PATH=/ERP_draft_1/ VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<publishable key> npm run build
npm run test:secrets -- --require-dist
```

Then publish `dist/` with any static host.

### Public pickup website (`site/`, CLAUDE.md D12)

The same workflow also builds the public website under `/<repo>/site/` (`VITE_SITE_BASE_PATH`), against the same Supabase project, and publishes it next to the staff app: `https://<user>.github.io/<repo>/site/`. The site needs only the project URL and the publishable/anon key, which can reach the `web_*` functions and nothing else. Its `<meta>` Content-Security-Policy allows network calls to that project only. The secret scan covers both bundles.

By hand:

```bash
VITE_SITE_BASE_PATH=/ERP_draft_1/site/ VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<publishable key> npm run site:build
npm run test:secrets
```

Then publish `site/dist/` under `<repo>/site/`. Before the pilot site takes orders, follow `website-runbook.md`.

> **Check before running the workflow:** `pages.yml` currently sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as fixed values at the top of the build job instead of reading the chosen environment's variables, so choosing `pilot` would still build against that fixed project. Confirm which project those values belong to, and switch them to `${{ vars.VITE_SUPABASE_URL }}` / `${{ vars.VITE_SUPABASE_ANON_KEY }}` before a pilot deployment.

### Public website on Vercel (custom domain)

The public website can also be served by Vercel (operator decision, 2026-11-26), with the staff ERP staying on GitHub Pages. `vercel.json` makes Vercel build **only** the site: `npm ci`, then `npm run site:build`, publishing `site/dist` from the domain root. It also sends security headers (no framing, `nosniff`, a strict referrer policy, no camera/microphone/location/payment access) and caching for the hashed bundles and photos.

Vercel project settings: production branch `main`; environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the chosen Supabase project (public values; `VITE_SITE_BASE_PATH` stays unset so the site serves from `/`). The custom domain is added in the project's Domains settings; when it was bought elsewhere, the registrar needs the DNS records Vercel shows. While the site talks to the demo project, every page shows a "Demo site" banner, driven by the database's data mode.

### After publishing

- Open `https://<user>.github.io/<repo>/#/login`, sign in, then reload on a deep link such as `#/kitchen`. You should stay on that screen (AC30). The automated equivalent runs against a local static preview under the same base path (`tests/e2e/foundation.spec.ts`).
- The header banner must read **PILOT — real data** for the pilot build. It comes from the database, not from the build.

## 3. Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on manual start. It runs typecheck, lint, format, unit tests, build with secret scan, and then the full database, integration and end-to-end suites on a disposable local Supabase stack inside the runner. It never deploys and never connects to a hosted project. CI ran green on the first pull request.

## 4. Updates

- **Schema:** add a new migration (never edit an applied one). Take a manual backup (`backup-restore.md`), then `supabase db push` to the demo first and run the acceptance suite there, then the pilot.
- **Order matters:** when a release adds a migration, update the database first (demo: **Actions → Demo project setup**, which applies only the missing migrations), then deploy Pages. A site newer than its database shows a red "Database out of date" banner after sign-in (ADR 0036). Bump `EXPECTED_SCHEMA_VERSION` in `src/lib/schemaVersion.ts` with every migration.
- **Frontend:** re-run the Pages workflow for the target.
- **Rollback:** frontend, re-run the workflow from the previous commit. Database, restore from the backup taken before the change (see `backup-restore.md`); migrations are not reversed by hand.
