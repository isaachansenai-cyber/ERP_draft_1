# 0031 Backup/restore drill on a disposable local database (AC31)

- CLAUDE.md §10 allows the drill to run locally unless the operator directs a hosted run. The drill takes a full `pg_dump` (custom format, as the container superuser) and restores it into a new database in the local cluster. That database is the disposable copy, and it is dropped afterwards.
- "Intact" is checked strictly:
  - Every `public` and `private` table must have the same row count and content hash.
  - The `auth.users` count must match.
  - 15 ledger and document totals must be identical.
  - The copy must still reconcile (every balance equals its movements) and must keep RLS, the append-only triggers and the API grant limits.
- The hosted procedure (nightly `pg_dump`, encrypted storage, restore into a disposable project, `DRILL_MODE=compare`) is documented. It is not performed, because it needs real projects and credentials. It is the evidence for the `backup_restore_tested` gate.
