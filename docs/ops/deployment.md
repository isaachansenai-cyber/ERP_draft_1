# Deployment (GitHub Pages + Supabase)

Deployment is an operator action. This build prepares it but has **not** published anything.

## Frontend (GitHub Pages)

1. Build with the repository base path and the target project's **public** values only:

   ```bash
   VITE_BASE_PATH=/ERP_draft_1/ VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<publishable/anon key> npm run build
   ```

2. Run `npm run test:secrets -- --require-dist`. It must pass. It fails if the bundle contains a service-role key, a secret key, a database URL or `service_role`.
3. Publish `dist/` to GitHub Pages, for example with the `actions/deploy-pages` workflow. The app uses hash routing, so no 404 rewrite is needed.
4. In the Supabase project (Auth → URL configuration), add the Pages URL to the site URL and redirect URLs.

Build the pilot and the demo separately, each with its own project URL and key. A frontend switch alone is never the isolation boundary.

## Database

- Apply the migrations with `supabase db push` to each project (pilot, demo).
- Check the Supabase security advisor afterwards. The schema passes `supabase db lint` locally with no findings.
- Backup and restore are documented and tested in Milestone 5 (`docs/ops/backup-restore.md`).
