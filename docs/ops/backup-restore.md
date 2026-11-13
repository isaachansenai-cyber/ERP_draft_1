# Backup and restore

**Targets (PRD §15):** a daily backup, and a pilot restore within **4 hours**. Do not assume the Supabase plan provides point-in-time recovery. Check the plan's backup features before go-live, and keep the independent nightly dump below either way.

## What was tested (local drill)

`scripts/ops/backup-restore-drill.ts` runs the whole cycle against the local stack:

1. A full `pg_dump` (custom format) of the database is taken as the Postgres superuser inside the local Supabase container.
2. The dump is restored into a new disposable database.
3. Verification:
   - Every table in `public` and `private` has the same row count and content hash.
   - `auth.users` has the same count.
   - 15 business totals are identical: movements, quantities and value; on hand and reserved; inventory value; completed orders and totals; tenders; refunds; supplier invoices and payments; time entries; audit rows; demo history; settings.
   - In the copy, the ledger still reconciles (every balance equals the sum of its movements). RLS is on for every public table, the append-only triggers exist, API roles cannot write movements, and updating a movement is refused.
4. The disposable database is dropped.

```bash
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:54322/postgres npx tsx scripts/ops/backup-restore-drill.ts
```

The latest result is in [`docs/acceptance/evidence/backup-restore-drill.md`](../acceptance/evidence/backup-restore-drill.md). It covered a demo database with 50,000 operational order lines plus history. The backup was 6.3 MB in about 1 s, the restore took about 3 s, and there were 0 mismatches. `tests/integration/demo/ac31-backup-restore.test.ts` repeats the drill on every integration run.

## Hosted procedure (operator; not yet performed)

The steps below need operator direction and real credentials. They are written for the pilot and must be rehearsed once against a **disposable** Supabase project before real pilot entry (gate `backup_restore_tested`).

### Nightly backup

Run from a trusted machine, never from CI logs or the browser. Use `pg_dump` **17** to match the server.

```bash
# The connection string comes from the Supabase dashboard (session pooler or direct), with sslmode=require.
# Keep it in a password manager or an env file with mode 0600; never commit it.
pg_dump "$PILOT_DATABASE_URL" -Fc --no-comments -f "pilot-$(date -u +%F).dump"
```

- Store the dump encrypted (for example `age` or `gpg`) on storage that only the owner can read, and keep at least 14 daily copies.
- A dump contains staff names, customer records and money records. Treat it as pilot data: never commit it (`*.dump` is gitignored) and never upload it to the demo project.

### Restore into a disposable project (rehearsal) or a replacement project (recovery)

1. Create a new Supabase project in the same region (an operator action).
2. Restore. Supabase-managed schemas (`auth`, `storage` and so on) already exist in a new project, so restore the application schemas and the auth users:

   ```bash
   pg_restore -d "$RESTORE_DATABASE_URL" --no-owner --role=postgres -n public -n private "pilot-YYYY-MM-DD.dump"
   pg_restore -d "$RESTORE_DATABASE_URL" --data-only -t users -t identities -n auth "pilot-YYYY-MM-DD.dump"
   ```

   If schema-level restore conflicts, apply the migrations first (`supabase db push`), then restore with `--data-only --disable-triggers` for `public` and `private`, still as the database owner.
3. Verify the copy against the source with the same checks the local drill uses (read-only on both sides):

   ```bash
   DRILL_MODE=compare SOURCE_DATABASE_URL="$PILOT_DATABASE_URL" RESTORED_DATABASE_URL="$RESTORE_DATABASE_URL" \
     npx tsx scripts/ops/backup-restore-drill.ts
   ```

   It writes the evidence report with counts and hashes only, no data rows. Any mismatch fails the run. For a rehearsal against a live pilot, take the dump during a quiet period so that both sides are compared at the same point.
4. Rehearsal: record the elapsed time from "start restore" to "verified" (target 4 hours or less). Then the owner confirms `backup_restore_tested` with the evidence report as the note, and deletes the disposable project.
5. Recovery: point the pilot frontend build at the new project (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), re-run the secret scan, publish, update the Auth URL configuration, and tell staff to sign in again. Any orders taken on paper during the outage are entered afterwards following [`manual-outage-fallback.md`](manual-outage-fallback.md).

## What a restore does not bring back

Anything after the dump was taken. Expect to re-enter the period between the last backup and the failure from the paper fallback records. A daily backup means up to one day of re-entry; take an extra manual dump before risky operator actions such as migrations.
