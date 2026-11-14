# Demo project setup

The demo is a **separate** Supabase project, or the disposable local stack. It holds only synthetic fixtures: 47 items (including 2 synthetic retail sauces), 10 customers, 10 role fixtures, 141 location/item settings, synthetic prices, taxes, packs and terms, and six months of synthetic sales history. **Never run these steps against the pilot project.** The scripts and the database itself refuse to.

## Guards

Every demo script refuses (exit code 2, `REFUSED: …`) unless both of these hold:

1. The project ref derived from `DATABASE_URL` (and `SUPABASE_URL`, which must agree) is listed in `DEMO_PROJECT_REF_ALLOWLIST`. The ref is never taken from a command-line argument. Use `local` for the local stack.
2. The database reports `app_settings.data_mode = 'demo'`.

The database also enforces the separation itself:

- Synthetic rows are rejected by triggers while it is in pilot mode.
- History and audit tables cannot be truncated outside demo mode.
- A database can only be switched to demo mode while it is still pristine: no staff, customers, prices, taxes, history, confirmed gates or non-import audit rows. A pilot in use can therefore never become a resettable demo.
- There is no reset or seed RPC in any project. Reset needs direct database credentials.

## Steps

Put the values in a gitignored env file, then export them:

```bash
DATABASE_URL=postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key; demo project only, never in the frontend>
DEMO_PROJECT_REF_ALLOWLIST=<ref>
```

Then run, in order:

1. Apply the migrations to the new, empty demo project (`supabase db push` against the demo project).
2. `npx tsx scripts/demo/init-demo-database.ts`: switches the pristine database to demo mode (dataset `demo-2026-v1`).
3. `npm run import:demo`: imports the source master (idempotent), the demo seed, then the history. Each step verifies its counts and totals: 12,775 orders, 16,501 lines, 184 days, 552 location-days, net sales 30,682,004 cents.
4. `npm run demo:users`: creates or updates Auth users `demo-…@example.invalid` for the 10 role fixtures and links them to their staff records. Each run generates **new random passwords** and writes them **only** to the gitignored `DEMO_CREDENTIALS.local.md`, with mode 0600. Share that file privately. Never commit it.

To reset the demo to a reproducible state later, run `npm run demo:reset`. It wipes the demo data, re-imports everything and re-keys the demo users. The integration suite verifies that a reset rebuilds identical content.

## Demo opening stock

`npm run import:demo` posts the 126 synthetic opening-stock rows (42 per location) through the stock ledger: lots, opening movements, balances and weighted-average valuation. It is idempotent per location. The demo POS can therefore sell immediately. Demo payments are **simulated**: no money moves.

## Demo return policy

The demo seed also stores a synthetic return policy, labeled `synthetic_demo_policy`: a 30-day window, with unopened retail sauces allowed back into stock. Restocking a returned bottle restores its original issue cost and reverses that retail COGS once. Demo refunds and supplier payments are **simulated** records. The pilot never receives this policy: its owner sets one, and restocking is off by default.

## Hosted demo via GitHub Actions

Or run **Actions → Demo project setup**. It applies any migrations missing from the database's migration history (`supabase db push`), switches an empty database to demo mode, runs the imports and creates the demo logins. Every step is idempotent, so it is safe to re-run. Do not rely on the Supabase GitHub integration alone: on the first deploy it did not apply the migrations. It needs the repository secrets described at the top of `.github/workflows/demo-setup.yml`. `DEMO_SUPABASE_SERVICE_ROLE_KEY` must be the project's **secret** key (`sb_secret_…`) or legacy `service_role` key, never the publishable key. The workflow checks the key's kind and stops if it is wrong. The demo passwords are uploaded only as an **encrypted** artifact that expires after 1 day. To decrypt it:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in demo-credentials.md.enc -out DEMO_CREDENTIALS.local.md
```

Enter the passphrase you stored as `DEMO_CREDENTIALS_PASSPHRASE`. Keep the decrypted file private and never commit it.
