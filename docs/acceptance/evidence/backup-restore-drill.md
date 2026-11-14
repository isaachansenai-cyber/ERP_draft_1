# AC31 backup/restore drill (generated)

Run 2026-11-13T21:21:51.040Z by `scripts/ops/backup-restore-drill.ts` (mode: drill). local Supabase stack; full pg_dump (custom format) of database "postgres" restored into disposable database "restore_drill_mwfhfbni" in the same cluster

- Backup: 6.3 MB in 0.9 s. Restore: 3.4 s (target: within 4 hours). Verification: 0.7 s. Restore warnings: 0.
- Tables compared (public + private, row counts and content hashes): **72**, mismatches: **0**.
- Business totals compared: **15**, mismatches: **0**.
- Restored copy: ledger balances not matching movements = 0; invalid balances = 0; public tables without RLS = 0; append-only triggers = 32; API roles can write movements = false; updating a movement: refused (immutable:inventory_movements).
- Result: **PASS — the copy is identical and its controls are intact**.

## Totals (identical in source and copy)

| Total | Value |
|---|---|
| movements | 1532 |
| movement_qty | 711253.100000 |
| movement_value | 2565.965200 |
| on_hand | 711253.100000 |
| reserved | 0.000000 |
| inventory_value | 2565.965200 |
| completed_orders | 25144:150393776 |
| tenders_cents | 150393776 |
| refunds_cents | 0 |
| invoices | 0:0 |
| supplier_payments_cents | 0 |
| time_entries | 0 |
| audit_rows | 686 |
| history | 12775:30682004 |
| settings | demo:true |

A hosted drill (pilot backup restored into a disposable Supabase project) follows `docs/ops/backup-restore.md` and is an operator action.
