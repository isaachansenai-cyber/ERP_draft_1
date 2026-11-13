# Pilot setup runbook

This is the complete runbook for taking the pilot live (Milestones 1–5). Sections 1–11 set it up; section 12 is the go-live checklist. The pilot is a **separate** Supabase project, and it never receives demo data or demo tooling.

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
| `supplier_master_verified` (per supplier) | Payment terms are entered (**Purchasing → Suppliers & packs**, owner) |
| `pack_conversions_verified` (per supplier item) | Pack size and quoted/estimated cost are entered (**Purchasing → Suppliers & packs**, owner) |
| `opening_counts_posted` (per location) | The location's opening count is posted (**Inventory**, manager; needs `perishables_confirmed`) |
| `return_policy_configured` | The owner has saved a return policy (**Settings & setup → Return policy**) |
| `planning_inputs_confirmed` (per location) | Attestation: the owner has reviewed the ordering-cost and holding-cost basis and the max-cover-days policy for the location. Until then managers can preview EOQ but cannot save approved settings |
| `roles_verified`, `perishables_confirmed`, `backup_restore_tested`, `acceptance_suite_passed` | Attestation, recorded with the evidence note |

Operational posting stays off until the owner runs **Enable posting**, which requires `roles_verified`, `backup_restore_tested` and `acceptance_suite_passed`. Reopening any of those three turns posting off again.

## 6. Opening stock and first sale

1. The owner confirms `perishables_confirmed` after reviewing which items need use-by dates (the refrigerated/frozen ingredients by default).
2. Each location's manager physically counts stock and posts the **opening count** in **Inventory**: quantity in base units, verified unit cost, optional lot code, and a use-by date for perishables. It can be posted only once per location.
3. The owner confirms `opening_counts_posted` for that location, and the remaining gates, then runs **Enable posting**.
4. Staff can now take orders in **POS**. Ingredients are reserved on acceptance, issued at kitchen start, and payments are recorded as handled outside the app.

## Known limitation recorded at setup

The simplified production model records standard ingredient consumption at kitchen start. It does not track marination, braising, prepared-food batches or yields (PRD §2). Use physical counts and reason-coded waste to find differences.

## 7. Returns, refunds and supplier invoices

1. **Return policy (owner).** Under **Settings & setup → Return policy**, set the return window in days and decide whether unopened, shelf-stable retail returns may go back into stock. The default is **no restock**. Then confirm `return_policy_configured` with an evidence note. Retail returns are refused until then. Meals are always refunded, never returned.
2. **Refunds.** Under **Refunds & returns**, staff find a completed order by number or pickup code. Each refund is a record of money paid back outside the app (`MANUAL_EXTERNAL`). Employees need a manager to enter their PIN. The amount comes from the original line price, discount and tax, and cannot exceed what was recorded as paid.
3. **Cancelling a paid order.** The kitchen cancel form asks how the payment was paid back and records the refund in the same step (manager approval).
4. **Returned goods.** Managers decide each held return under **Refunds & returns → Returned goods**: restock (only if the policy allows it) or dispose with a note.
5. **Supplier invoices (managers).** Under **Supplier invoices**, enter the invoice against the receipt lines it bills, plus any charge lines.
   - Until a supplier's `supplier_master_verified` gate is confirmed, the invoice's own due date must be entered.
   - Variances against the receipt must be accepted before payment.
   - Payments and credits are records of money handled outside the app. Mistakes are reversed, never edited.

## 8. Stock controls

- **Counts (managers):** **Inventory → Counts**. Start the count, physically count, enter quantities and post with a reason. If stock moved for a counted item in the meantime (a sale, receipt or waste), the count is rejected: cancel it and start again.
- **Waste (all staff report, managers post):** **Inventory → Waste reports**.
- **Quarantine (managers):** from the lot list on **Inventory**, quarantine suspect stock (it stays on hand but cannot be sold) and release it when cleared. Expired lots cannot be released.
- **Transfers (managers):** **Inventory → Transfers**. The sending manager dispatches. The receiving location's manager records what arrived and any loss with a reason.

## 9. Planning inputs (managers, after the owner confirms `planning_inputs_confirmed`)

1. Under **Planning → ROP / EOQ settings**, choose an item and enter: reorder point and safety stock (base units), S = ordering cost in USD per order, H = holding cost in USD per base unit per year, and a max-cover-days freshness cap if wanted.
2. A new pilot has under 28 days of sales, so the annual demand shows **insufficient**: enter a manager annual-demand figure (base units/year) until the history builds up. **Preview EOQ** shows the unconstrained EOQ and the pack-rounded actionable quantity separately, with a warning if the cover-days cap is exceeded.
3. **Save as approved settings.** Each save is audited.
4. Until there is sales history, **Planning → Forecast** shows "manager forecast required". Select a day to enter the expected servings with a reason. Proposals in **Ingredient projection** become orders only through **Save as draft PO**, which is then reviewed and submitted under Purchasing.

## 10. Staff time

- Managers create shifts under **Staff time → Schedule** (times are entered in Denver time) and publish them. Employees see only their own published shifts.
- Staff clock in and out under **Staff time** on the shared tablet; the time comes from the server. Breaks are recorded only when the employee starts and ends one.
- Mistakes are fixed by another manager under **Staff time → Time records & hours → Correct…** with a reason. The original times stay on record. Open entries are listed as exceptions and are never closed automatically.
- This is not payroll: there are no pay rates, overtime or automatic break deductions.

## 11. Labels

Print the item labels from **Labels** (filter by category if needed). Use the **Scanner test** field to check that each scanner reads the code back correctly before go-live.

## 12. Go-live checklist (owner)

Work top to bottom. Every gate is confirmed under **Settings & setup → Pilot setup** with an evidence note, and every confirmation is audited.

| # | Step | Evidence for the gate note |
|---|---|---|
| 1 | Pilot project created, migrations pushed, security advisor clean ([`deployment.md`](deployment.md) §1) | Advisor screenshot date |
| 2 | Source master imported; supplier contacts, pack sizes, costs, terms and lead times checked against real supplier documents → `supplier_master_verified`, `pack_conversions_verified` | Who checked, against which documents |
| 3 | Recipes checked with the kitchen (portions, yields) → `recipes_verified` per dish. Record the simplified production limitation (§ "Known limitation" above) | Kitchen lead's name and date |
| 4 | Tax rate and menu prices entered → `tax_rate_confirmed`, `menu_prices_confirmed` per location | Source of the tax rate |
| 5 | Perishable list reviewed → `perishables_confirmed` | Who reviewed it |
| 6 | Return policy saved → `return_policy_configured` | Window and restock decision |
| 7 | Opening counts posted with use-by dates → `opening_counts_posted` per location | Count sheet reference |
| 8 | Planning cost basis reviewed → `planning_inputs_confirmed` per location | S and H basis |
| 9 | Staff invited and given roles; each person signs in once; managers set PINs → `roles_verified`. Before confirming, run the permission suite against the **local** stack (`npm run test:integration`) and spot-check in the pilot that an employee cannot see costs or another location | Test run date and the spot checks done |
| 10 | Backup rehearsal: take a pilot backup, restore it into a **disposable** project, verify with `DRILL_MODE=compare` ([`backup-restore.md`](backup-restore.md)), delete the disposable project → `backup_restore_tested` | Elapsed restore time and the drill report |
| 11 | Full acceptance suite run on the exact commit being deployed (`npm run typecheck && npm run lint && npm run test:unit && npm run test:db && npm run test:integration && npm run test:e2e -- --trace off`), with results matching `docs/acceptance/ACCEPTANCE_REPORT.md` → `acceptance_suite_passed` | Commit hash and pass counts |
| 12 | Tablet check at each location: sign in on the shared tablet, scan five labels with the real scanner in **Labels → Scanner test** and at the POS (an `ING-` label must not add anything), and print one label sheet | Location, device, scanner model |
| 13 | Manual outage fallback printed and briefed to each shift lead ([`manual-outage-fallback.md`](manual-outage-fallback.md)) | Briefing date |
| 14 | Pilot frontend published with the pilot project's URL and key ([`deployment.md`](deployment.md) §2); banner reads **PILOT — real data**; deep-link reload works | Pages URL |
| 15 | **Enable posting** (requires `roles_verified`, `backup_restore_tested`, `acceptance_suite_passed`) | — |

After go-live, keep the nightly backup running and repeat the restore rehearsal after any major migration.
