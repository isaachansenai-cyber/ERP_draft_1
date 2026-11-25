# 0036 Schema version check

Found while debugging (session, 2026-11-25). Spanish Fork employee 1 could not record waste, and the Spanish Fork manager could not open an item chart. Both screens call functions from migration 0023. Pages was redeployed with that code on 2026-11-18, but the hosted demo database was last set up on 2026-11-14 and never received 0023. Locally, with all migrations applied, both screens work.

- `public.get_schema_version()` returns the number of the latest migration. Every new migration re-creates it with its own number (`create or replace`), and `src/lib/schemaVersion.ts` holds the number the build expects.
- After sign-in, the app shell compares the two and shows a red banner when the database is behind ("run Demo project setup") or ahead ("reload the page").
- A missing function (PostgREST `PGRST202`) now maps to `schema_out_of_date` with the same advice, instead of the generic "request was not accepted", so even screens that load before the check explain themselves.
- Signed-in users only. The anonymous API surface stays limited to `get_public_app_mode` (`001_schema_security`), so the login page shows no banner.
- `docs/ops/deployment.md`: when a release adds a migration, run Demo project setup *before* deploying Pages.
