# Pilot setup runbook

This covers what exists after Milestone 1. Later milestones add steps such as opening counts, packs and terms, and the backup/restore drill. The pilot is a **separate** Supabase project, and it never receives demo data or demo tooling.

## 1. Create the pilot database (operator)

1. Create a new Supabase project for the pilot. Use a different project from the demo.
2. Apply the migrations from `supabase/migrations/` with `supabase db push`. The database starts in **pilot mode** with posting disabled and every setup gate open.
3. Do **not** set `DEMO_PROJECT_REF_ALLOWLIST` to the pilot ref anywhere.

## 2. Import source master data

```bash
DATABASE_URL=<pilot connection string, ?sslmode=require> npm run import:source
```

This imports the 45 source items, 66 recipe lines (as version 1), 15 suppliers and 40 primary links, with lead times labeled `Benchmark` or `Assumption`.

- Pack sizes, costs and payment terms stay empty. Real values are entered later and checked through the setup gates.
- Supplier, pack and recipe gates are created as **open**.
- Re-running the import changes nothing. If the database ever differs from the source file, the import fails instead of overwriting anything.

## 3. Owner account

1. Invite the owner through Supabase Auth: Dashboard → Authentication → Invite user. Self sign-up is disabled.
2. In the SQL editor, run this once:

   ```sql
   select private.bootstrap_owner('owner@restaurant.example', 'Owner Name');
   ```

   It refuses if an owner already exists. It is not reachable through the API.
3. The owner signs in and sets a manager PIN under **Settings & setup → My manager PIN**.

## 4. Staff

For each staff member:

1. Invite them through Supabase Auth.
2. In **Settings & setup → Staff access**, the owner:
   - adds a staff record (display name only: no pay, tax or personal identifiers),
   - links the invited email,
   - grants a role: employee or manager at one location, or owner company-wide.

Managers set their own PIN. Every grant and revoke is audited. At least one active owner must always remain.

## 5. Setup gates

**Settings & setup → Pilot setup** lists every gate. A gate can be confirmed only by the owner, only with an evidence note, and only when its precondition holds:

| Gate | Precondition checked by the server |
|---|---|
| `tax_rate_confirmed` (per location) | A tax rate entered by the owner is effective today (**Taxes & prices**) |
| `menu_prices_confirmed` (per location) | Every active sellable item has a price effective today |
| `recipes_verified` (per dish) | An active recipe version exists. The evidence note records the portion/yield check |
| `supplier_master_verified` (per supplier) | Payment terms are entered. The entry screen arrives in Milestone 2 |
| `pack_conversions_verified` (per supplier item) | Pack size and quoted/estimated cost are entered. The entry screen arrives in Milestone 2 |
| `opening_counts_posted`, `planning_inputs_confirmed`, `return_policy_configured` | Not confirmable until their workflows ship (Milestones 2–4) |
| `roles_verified`, `perishables_confirmed`, `backup_restore_tested`, `acceptance_suite_passed` | Attestation, recorded with the evidence note |

Operational posting stays off until the owner runs **Enable posting**, which requires `roles_verified`, `backup_restore_tested` and `acceptance_suite_passed`. Reopening any of those three turns posting off again.

## Known limitation recorded at setup

The simplified production model records standard ingredient consumption at kitchen start. It does not track marination, braising, prepared-food batches or yields (PRD §2). Use physical counts and reason-coded waste to find differences.
