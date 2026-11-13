# Meats Around the World ERP (MVP pilot)

This is an internal restaurant ERP for the three Meats Around the World locations: **Provo, Spanish Fork and Salt Lake City**. It links purchasing, a lot-tracked stock ledger, recipe-based order fulfilment through a staff POS, a kitchen/pickup queue and recorded payments to operational reporting. Every stock movement and every cost can be traced back to the document that caused it.

- **Frontend:** React 18, TypeScript (strict) and Vite, built as a static site for GitHub Pages with hash routing.
- **Backend:** Supabase Auth, Postgres, row-level security and transactional PL/pgSQL RPC functions.
- **No payment gateway:** payments are *records* of money handled outside the app. The demo marks them "simulated"; the pilot marks them "recorded".

| Document | Purpose |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Build rules and operator decisions for the coding agent |
| [`docs/spec/ERP_MVP_PRD.txt`](docs/spec/ERP_MVP_PRD.txt) | Product specification (PDF/DOCX copies alongside) |
| [`docs/acceptance/Acceptance_Checklist.csv`](docs/acceptance/Acceptance_Checklist.csv) | The 34 launch checks with current status and test evidence |
| [`docs/acceptance/PROGRESS.md`](docs/acceptance/PROGRESS.md) | Per-milestone progress notes, test counts, limitations |
| [`docs/decisions/`](docs/decisions/) | ADRs 0001–0029 for choices the PRD leaves open |
| [`docs/ops/pilot-setup.md`](docs/ops/pilot-setup.md) | Pilot setup runbook |
| [`docs/demo/README.md`](docs/demo/README.md) | Demo project setup and demo logins |
| [`docs/ops/deployment.md`](docs/ops/deployment.md) | GitHub Pages and Supabase deployment notes |

---

## 1. Status

| Milestone | Scope | State |
|---|---|---|
| 1 Foundation | Schema, Auth/roles, RLS, pilot/demo separation, setup gates, importers, app shell | **Done** |
| 2 Complete restaurant transaction | Purchasing → partial receipt → stock → POS (reservation) → kitchen (issue) → ready → payment → pickup → dashboard | **Done** (see §9 for which acceptance checks fully pass) |
| 3 Inventory & financial controls | Counts, waste, quarantine, transfers, refunds, returns/exchanges, supplier invoices/payments/credits | **Done** (every exit check passes; see §9) |
| 4 Planning & staff tools | Forecast/MRP, ROP/EOQ, "What can we serve", labels, schedules, clocking, corrections, hours | **Done** (every exit check passes; see §9) |
| 5 Pilot readiness | Full acceptance run, performance, backup/restore, deployment | Not started |

Acceptance checklist today: **30 PASS, 3 PARTIAL, 1 NOT_RUN** (all four open checks are Milestone 5 work). Each PARTIAL lists exactly what remains and which milestone delivers it.

---

## 2. What the app does today

### Screens (hash routes)

| Route | Who | What it does |
|---|---|---|
| `#/login` | everyone | Staff sign-in. No self sign-up. The data-mode banner (PILOT/DEMO) comes from the server. |
| `#/` Overview | all staff | Signed-in identity, location and role, business date, posting status, open setup gates |
| `#/dashboard` | all staff (scoped) | Sales summary per location: completed orders, gross sales, discounts, refunds, net sales, tax, recorded payments and refunds paid out, average order value, COGS (less retail COGS reversed), gross margin, waste with its breakdown (post-start cancellations, posted waste reports, transit losses), count variance, inventory and in-transit value, supplier balance and overdue, pending prep cost, low-stock items, fulfillment time, cancellations. Cost, stock-value and supplier figures are for managers and the owner only. Date range, location scope and (demo only) a historical data source. CSV export uses the same server function. |
| `#/pos` | staff at the location | Menu with live "available now" counts and the limiting ingredient, plus a barcode/keyboard-wedge input. Scanning `ING-*` shows "Ingredient — not sellable". The cart is kept as a labeled **unsent draft**. Also: optional customer search/create, pickup name, kitchen note, manager-approved discount (with PIN dialog for employees), an estimated total, **Accept order**, then record the payment. |
| `#/kitchen` | staff at the location | Queue in three columns (accepted, preparing, ready) showing pickup code, name, items, age, ETA and prep notes. Explicit **Start preparation**, **Mark ready** and **Complete pickup** (blocked until the balance due is 0). **Cancel** releases stock before start; after start it records waste with manager approval. If a payment was already recorded, the cancellation records its refund too (manager approval, refund method). Refreshes every 10 s. |
| `#/inventory` | staff (costs: managers) | Per item: on hand, reserved, quarantined, available, expired, lots with use-by. Average cost and value for managers. One-time **opening count** form. Menu availability on/off switches. Managers can **quarantine** part of a lot or **release** it. |
| `#/inventory/counts` | managers | Start a count (all items or a filtered set) that snapshots each lot; enter physical quantities; post with a reason. A count is rejected if stock moved after its snapshot, and can never go below reserved stock. |
| `#/inventory/waste` | staff submit, managers decide | Employees report waste (items, quantities, reason, note). Nothing moves until a manager **posts** it (removing unreserved stock: quarantined, then expired, then earliest use-by) or **rejects** it with a reason. Costs are shown to managers only. |
| `#/inventory/transfers` | managers | Create a transfer to another location, **dispatch** it (stock goes in transit), and at the destination **receive** what arrived, recording any loss with a reason. Partial receipts keep the rest in transit. |
| `#/returns` | staff (employees with a manager PIN) | Find a completed order by number or pickup code, then **refund** units (from the original price, discount and tax), record a **retail return** (goods go to held custody, optional refund) or an **exchange** for another retail item, all in one step. |
| `#/returns/custody` | managers | Returned goods awaiting a decision: **restock** at the original cost (only unopened shelf-stable retail, only if the return policy allows it) or **dispose** with a note. |
| `#/invoices` | managers, owner | Enter supplier invoices matched to receipt lines (plus charge lines such as freight). See quantity and price variances; accept a discrepancy before paying; record payments and credits; reverse them; correct an invoice as a new revision; void an invoice with nothing applied. Balances and overdue status come from the server. |
| `#/purchasing/orders` | managers, owner | Create a draft PO from the supplier's pack list, submit it (placed outside the app), **receive** actual packs with lot, use-by and actual pack cost, acknowledge over-receipts, close the open balance |
| `#/purchasing/suppliers` | managers view, owner edits | Supplier contacts (unverified, missing phones left blank), payment terms, pack size and cost per supplier item (quoted/estimated), with provenance badges |
| `#/planning` | managers, owner | 14-day forecast per sellable item with method, observations, history window and manager overrides; select a cell to see how it was computed and enter a manager forecast. Demo only: a labeled "demo historical (synthetic)" source. |
| `#/planning/projection` | managers, owner | Per ingredient: daily projected balance (available stock + receipts on their expected dates − exploded requirements), safety stock, ROP and suggested ROP, shortage date, proposed order date (late flag), pack-rounded proposed quantity, late/undated POs. **Save as draft PO** creates a normal draft purchase order. |
| `#/planning/settings` | managers, owner | Per item: estimated annual demand (or "insufficient"), current settings with units, EOQ and the pack-rounded actionable quantity; edit ROP, safety stock, S (USD/order), H (USD/base unit/year), max cover days and an annual demand input; **Preview EOQ**; **Save as approved settings** (needs the planning gate). |
| `#/serve` | all staff (planning detail: managers) | What can we serve: per dish, portions possible now (independent, not additive), the limiting ingredient, today's served/cooking/accepted counts, planned demand (managers) and the next delivery. Managers get the **menu-mix simulator** (shared ingredients summed, shortages and pack-rounded replenishment preview; saves nothing). |
| `#/staff` | all staff | Clock in/out and unpaid breaks on the server clock, my published shifts, my hours for 14 days. |
| `#/staff/schedule` | managers | Create draft shifts (Denver times), publish, change times (reason needed once published), cancel with a reason. |
| `#/staff/time` | managers | Hours per staff member per local business date, open-entry exceptions, entries with breaks and correction history; **Correct…** with a mandatory reason. |
| `#/labels` | all staff | Code 128 labels for every item (readable ID, name, base unit), category filter, **Print**, and a scanner test field. |
| `#/settings/setup` | all view, owner acts | Pilot setup gates with status, who confirmed and evidence. Confirm/reopen. Enable posting. |
| `#/settings/taxes-prices` | owner (tax), managers (prices) | Effective-dated tax rates and menu prices. Past values can never be rewritten. |
| `#/settings/return-policy` | all view, owner edits | Retail return window and whether unopened shelf-stable returns may go back into stock |
| `#/settings/staff` | owner (managers view) | Staff records, link invited sign-in accounts, grant/revoke roles |
| `#/settings/account` | owners, managers | Set the manager approval PIN |

Every write screen shows loading, empty, validation, unauthorized, conflict (stale version), offline and success states. An error boundary prevents blank screens. Touch targets are at least 44 px, focus is visible, and status is shown as text as well as color.

### How a sale moves stock and money

1. **Receipt.** A manager receives packs against a submitted PO. Base quantity = packs × the snapshotted pack size, or a quantity in a verified unit. Each receipt creates a lot (with use-by), a `receipt` movement, a balance increase and a new weighted-average cost: *(old qty × old cost + received qty × receipt cost) ÷ new qty*. If valued stock was zero or less, the receipt cost becomes the average. Partial receipts leave the rest open. A retry with the same request key adds nothing. Over-receipts need an acknowledgement and are audited.
2. **Accept order** (POS). Prices, the tax rate and the active recipe version are snapshotted on each line, and the recipe is exploded into per-line requirements. Requirements are **aggregated across the whole order**, every item is checked, and stock is reserved **first-expiry-first-out** (earliest use-by, then receipt time, undated last). Expired and quarantined stock is never used. If anything is short, nothing is reserved, and the error names the ingredient and the shortfall.
3. **Start preparation** (kitchen). Lots are rechecked (an expired reservation is reassigned, or the start is blocked). The reserved ingredients are then **consumed once** at the weighted-average cost, which is recorded per order.
4. **Ready → pay → complete pickup.** No ingredient is issued again. Retail items are consumed at handover. Completion requires recorded payment = total, or a manager-approved 100% discount.
5. **Cancel.** Before start, the reservations are released. After start, a manager approves (in person or by PIN) and the issued cost is recorded as **waste**. Nothing is restocked or issued twice. If a payment was recorded, the cancellation also records its refund, with manager approval.
6. **Refund** (completed orders). The amount comes from each line's snapshotted net and tax. A partial refund of units is proportional, and the refund that reaches a line's last unit takes exactly what remains, so refunds can never exceed the line or the recorded payments. Meals are never restocked.
7. **Retail return and exchange.** Returned bottles go to a held custody record outside sellable stock. A manager later restocks them (demo policy) at the original issue cost, which reverses that retail COGS once, or disposes of them. An exchange returns, credits and sells the replacement in one transaction; if the replacement is short, nothing is recorded.

Stock controls: physical counts adjust with a reason and reject stale snapshots; waste reports are posted by managers; quarantined stock stays on hand and valued but is never available; transfers move stock through in-transit custody with reason-coded losses.

Planning: forecasts use only dates before the as-of date (same weekday over 8 weeks, else trailing 28 days, else a manager forecast). Today's accepted, cooking and fulfilled orders are subtracted before the recipe explosion because their ingredients are already reserved or used. Purchase orders count only on their expected date. EOQ = √(2DS/H) is computed in SQL with explicit units; settings are saved only by a manager after the owner confirms the planning gate.

Staff time: employees clock only themselves, on the server clock; one open entry per employee; entries and shifts never overlap; corrections keep the original values and a reason. Hours are elapsed time minus recorded breaks, split at Denver midnight across DST changes. No payroll.

Supplier payables: invoices are matched to receipts but never change stock or cost. Variances are shown and must be accepted before payment. Payments and credits cannot exceed the balance and are corrected only by linked reversals.

Money rules:
- Integer cents throughout.
- The discount is applied before tax, allocated across lines by largest remainder (ties by line order).
- Tax is rounded half up per line.
- Net sales = gross − discounts − refunds, with tax separate.
- COGS comes from issue-cost snapshots, less retail COGS reversed by restocks. Post-start cancellations appear only in waste.
- Refunds count on their own business date. Waste = post-start cancellations + posted waste reports + transit losses (each cost once).

### Pilot vs demo

- **Pilot** (default): payments, refunds and supplier payments are `MANUAL_EXTERNAL`. Nothing operational works until the owner confirms the setup gates and enables posting. Retail returns stay closed until the owner saves a return policy and confirms its gate; restocking returned goods is off unless the owner enables it. Synthetic data is rejected by database triggers.
- **Demo**: a separate project switched to demo mode while empty. It has synthetic fixtures (47 items, 10 customers, 10 role logins, synthetic prices, packs, terms and tax, 126 opening-stock rows posted through the ledger) and six months of read-only synthetic sales history (12,775 orders, $306,820.04 net). Payments, refunds and supplier payments are `SIMULATED`. A synthetic return policy (30 days, restock allowed) is seeded.

---

## 3. Architecture and security

- **The database is the system of record.** Each posting workflow is one `SECURITY DEFINER` function with a fixed empty `search_path`. In a single transaction it authorizes `auth.uid()` against memberships and checks the setup gates. It then validates, takes row locks in a consistent order, checks state and version, and enforces idempotency. Finally it writes the business rows and the audit row.
- **API roles can only SELECT**, filtered by RLS. They have no INSERT, UPDATE or DELETE on any table. `anon` can call only `get_public_app_mode`.
- **Append-only:**
  - inventory movements, lots, opening counts, receipts, tenders, order lines and events, issue costs, cancellation waste
  - refunds and refund lines, returns and return lines, COGS reversals, exchanges, transfer receipts
  - supplier invoice lines, payments, credits and their reversals (invoices cannot be deleted, only voided)
  - time corrections and forecast overrides
  - prices and tax rates, the audit log and demo history
- **Retry safety:** one request key per user intent (`private.request_log`, scoped per actor). A retry returns the stored result with `replayed: true`. Concurrent duplicates serialize on the key. `get_request_result` lets the client check an uncertain outcome before offering a retry. The UI never shows success before the database commit.
- **Concurrency:** stock rows are locked `(location, item, lot)` in order. Two sessions competing for the last portion produce exactly one acceptance (tested).
- **Secrets:** the bundle contains only the Supabase URL and the publishable/anon key. `npm run test:secrets -- --require-dist` scans the repository and the built bundle.

### Database migrations (`supabase/migrations/`)

| File | Contents |
|---|---|
| `0001_platform.sql` | Extensions, `private` schema, default privileges, error helper, locations, app settings / data mode, employees, memberships, identity helpers, idempotency log, audit log, synthetic-data guard |
| `0002_master_data.sql` | Units, items, standard costs, verified conversions, suppliers, supplier items, effective-dated prices and taxes, planning settings, closures, reason codes, customers |
| `0003_recipes.sql` | Immutable recipe versions and components |
| `0004_setup_gates.sql` | Pilot setup gates and their preconditions |
| `0005_demo_history.sql` | Read-only demo sales history, insertable only in demo mode |
| `0006_rls.sql` | RLS and SELECT grants for Milestone 1 tables |
| `0007_identity_setup_rpcs.sql` | Context, staff/membership, PIN, gate, posting, tax and price RPCs; first-owner bootstrap |
| `0008_demo_mode.sql` | Pristine-only demo switch, demo gate confirmation, demo reset (operator tooling only) |
| `0009_inventory_ledger.sql` | Lots, balances, valuation, append-only movements, reservations, first-expiry-first-out helpers, opening counts |
| `0010_purchasing.sql` | Supplier terms and packs, purchase orders, partial receipts, over-receipt acknowledgement |
| `0011_orders.sql` | Menu availability, orders and revisions, line snapshots, requirements, issue costs, cancellation waste, tenders, and the full order lifecycle RPCs; customer search/create |
| `0012_reads_reports.sql` | POS menu, stock overview, sales summary (operational and historical); demo reset extended |
| `0013_approvers.sql` | Approver list for the manager PIN dialog |
| `0014_fix_settings_updates.sql` | Bug fix: settings updates now include `WHERE` (see ADR 0014) |
| `0015_inventory_controls.sql` | Versioned stock counts, waste reports, quarantine/release, transfers with in-transit custody and reason-coded loss |
| `0016_refunds_returns.sql` | Return policy (backs its gate), refunds with snapshot limits, retail returns, custody, COGS reversals, exchanges, cancel-with-refund |
| `0017_supplier_ap.sql` | Supplier invoices with receipt matching and revisions, discrepancy acceptance, payments, credits, linked reversals, void, AP reads |
| `0018_reports_m3.sql` | Sales summary with refunds, COGS reversals, waste breakdown, count variance, stock and in-transit value, supplier balances; demo reset extended |
| `0019_m3_reads.sql` | Waste-report costs hidden from employees; waste and custody list functions |
| `0020_staff_time.sql` | Shifts (no overlap across locations), time entries (one open per employee, no overlap), breaks, immutable corrections, hours report split at Denver midnight |
| `0021_planning.sql` | Forecast overrides, forecast with provenance and same-day netting, MRP projection and proposals, `private.eoq`, EOQ inputs and settings, What can we serve, menu-mix preview; planning gate becomes confirmable |
| `0022_demo_reset_m4.sql` | Demo reset clears the Milestone 4 tables |

### RPCs available to signed-in staff (each authorizes server-side)

| Area | RPCs |
|---|---|
| Context and setup | `get_public_app_mode`, `get_my_context`, `get_request_result` |
| Staff access | `list_staff_access`, `create_employee`, `link_employee_auth_user`, `set_employee_active`, `grant_membership`, `revoke_membership`, `set_manager_pin`, `list_location_approvers` |
| Gates and posting | `confirm_setup_gate`, `reopen_setup_gate`, `enable_posting` |
| Prices, taxes, menu | `set_location_tax_rate`, `set_location_item_price`, `set_menu_availability`, `get_pos_menu` |
| Suppliers and purchasing | `set_supplier_terms`, `set_supplier_item_pack`, `create_purchase_order`, `submit_purchase_order`, `receive_purchase_order`, `cancel_purchase_order_balance` |
| Stock | `post_opening_count`, `get_stock_overview`, `change_stock_condition` |
| Counts and waste | `start_stock_count`, `post_stock_count`, `cancel_stock_count`, `submit_waste_report`, `decide_waste_report`, `list_waste_reports` |
| Transfers | `create_transfer`, `dispatch_transfer`, `cancel_transfer`, `receive_transfer` |
| Refunds and returns | `set_return_policy`, `get_order_for_return`, `record_refund`, `process_return`, `process_exchange`, `decide_return_custody`, `list_return_custody` |
| Supplier AP | `create_supplier_invoice`, `revise_supplier_invoice`, `accept_invoice_discrepancy`, `record_supplier_payment`, `reverse_supplier_payment`, `record_supplier_credit`, `reverse_supplier_credit`, `void_supplier_invoice`, `get_supplier_invoices`, `get_supplier_invoice`, `get_matchable_receipt_lines` |
| Orders | `accept_order`, `edit_accepted_order`, `start_order_preparation`, `mark_order_ready`, `record_tender`, `complete_order_pickup`, `cancel_order`, `search_customers`, `create_customer` |
| Planning | `get_demand_forecast`, `set_forecast_override`, `get_replenishment_plan`, `calculate_eoq`, `get_eoq_inputs`, `set_location_item_settings`, `get_serve_view`, `simulate_menu_mix` |
| Staff time | `create_shift`, `update_shift`, `publish_shift`, `cancel_shift`, `clock_in`, `clock_out`, `start_break`, `end_break`, `correct_time_entry`, `get_my_time_status`, `get_hours_report`, `list_location_staff` |
| Reporting | `get_sales_summary` |

The operator-only functions (`private.bootstrap_owner`, `private.enable_demo_mode`, `private.reset_demo_data`) are not reachable through the API at all.

---

## 4. Local development

### Prerequisites

- Node.js 20 or later, and npm
- Docker (for the local Supabase stack)
- If `public.ecr.aws` is blocked on your network, set `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` before running `supabase` commands

### Start a local pilot

```bash
npm ci
npm run db:start          # local Supabase (Postgres, Auth, REST)
npm run db:reset          # apply all migrations; a fresh database is in PILOT mode
npx supabase status       # API URL and keys
```

Create a gitignored `.env.local`:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
VITE_BASE_PATH=/
DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:54322/postgres
```

Then:

```bash
DATABASE_URL=... npm run import:source     # 45 source items, 66 recipe lines, 15 suppliers (idempotent)
npm run dev                                 # http://127.0.0.1:5173
```

Create the first owner (after inviting the Auth user):

```sql
select private.bootstrap_owner('owner@restaurant.example', 'Owner Name');
```

The rest of the pilot setup happens in the app (staff, terms, packs, taxes, prices, gates, opening counts, enable posting). See [`docs/ops/pilot-setup.md`](docs/ops/pilot-setup.md).

### Local demo

```bash
export DATABASE_URL=... SUPABASE_URL=http://127.0.0.1:54321 DEMO_PROJECT_REF_ALLOWLIST=local
npx tsx scripts/demo/init-demo-database.ts    # pristine database → demo mode
npm run import:demo                           # source + demo seed (incl. opening stock) + history
SUPABASE_SERVICE_ROLE_KEY=... npm run demo:users   # writes DEMO_CREDENTIALS.local.md (gitignored)
```

---

## 5. Tests

| Command | What it proves | Count |
|---|---|---|
| `npm run typecheck`, `npm run lint` | Strict TypeScript and ESLint, app and tooling | clean |
| `npm run test:unit` | Money mirror (largest remainder, half-up tax), cart and scanner rules, draft storage, error messages, request-key retry logic, tooling guards, secret scanner, Denver wall-clock conversion across DST | 39 |
| `npm run test:db` | Resets the local DB, then runs pgTAP: grants, RLS, search_path, synthetic guards, immutability, recipes, units, gates, idempotency, PIN lockout, demo switch, **ledger** (first-expiry-first-out, availability, weighted average, constraints, append-only), **controls** (append-only money rows, transfer reconciliation, invoice-number uniqueness, refund planning), **staff and planning** (EOQ vector and guards, both DST transitions, shift/time overlap constraints, immutable corrections) | 138 |
| `npm run test:integration` | Three suites as real local Auth users through the API: **pilot** (AC01, AC02, AC03, retries, gates), **pilot operations** (full pilot setup via RPCs, then AC04–AC27 except demo-only retail, and cross-location permissions), **demo** (AC02, AC34, demo logins, reset reproducibility, opening stock, retail and simulated payments, historical source, retail returns, restock and exchanges, history-based forecast and EOQ) | 47 + 71 + 26 |
| `npm run test:e2e` | Production build under `/ERP_draft_1/`: sign-in, deep-link reload, role-scoped UI, offline, lost responses and expired sessions on real order RPCs, the POS → kitchen → pickup → dashboard flow, purchasing with a partial receipt, waste reports, counts, transfers, a retail return with restock, supplier invoice matching and payment, labels and scanner test with print styles, clocking and shifts, planning, What can we serve | 22 |
| `npm run build && npm run test:secrets -- --require-dist` | AC30 secret scan of the repo and bundle | pass |

The integration and e2e suites **reset the local database** and refuse to run against anything but localhost.

---

## 6. Build and deploy

```bash
VITE_BASE_PATH=/ERP_draft_1/ VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build
npm run test:secrets -- --require-dist
```

Publish `dist/` to GitHub Pages. Hash routing means refreshes and deep links need no rewrite rules. Deployment is an operator action and **has not been performed**. See [`docs/ops/deployment.md`](docs/ops/deployment.md).

---

## 7. Repository layout

```
supabase/migrations/   0001–0022 (see §3)
supabase/tests/        pgTAP: 001 schema security, 002 invariants, 003 demo mode + PIN, 004 ledger, 005 controls,
                       006 staff + planning
scripts/import/        import-source-master, import-demo-seed (posts demo opening stock), import-demo-history
scripts/demo/          init-demo-database, create-demo-users, reset-demo (allowlist + demo-mode guarded)
scripts/security/      scan-secrets (AC30)
src/                   React app: auth/, components/ (shell, UI kit, approval fields, reason picker, error boundary),
                       lib/ (rpc, retry-safe mutation hook, money mirror, POS draft, formatting, reference data,
                       Denver time helpers),
                       pages/ (incl. inventory/ controls, settings/ panels)
tests/unit|integration/{pilot,ops,demo}|e2e
data/source/           source master data (pilot + demo)
data/demo/             synthetic demo fixtures and history (demo only)
docs/                  spec, acceptance, ops, demo, decisions
```

---

## 8. What was built, by milestone

### Milestone 1: Foundation

- **Project:**
  - Vite/React/TypeScript app, Supabase CLI config (self sign-up off), ESLint, Prettier, Tailwind
  - Vitest projects (unit, pilot, ops, demo), Playwright
- **Schema:**
  - identity, master data and recipes
  - pilot setup gates and app settings with a one-way, pristine-only switch to demo
  - append-only audit log, idempotency log, demo history
  - RLS with SELECT-only grants
- **Owner tools:** staff, roles, manager PIN (bcrypt, locks for 15 minutes after 5 failures), tax rates, prices, gates, posting switch
- **Importers:**
  - source master: insert-only, verifies every source field, re-running changes nothing
  - demo seed and demo history: verify counts and totals
- **Demo tooling:** init, demo users with random passwords in a gitignored file, reset. All refuse a non-allowlisted target or a pilot database.
- **App shell:** sign-in, server-driven data-mode banner, offline banner, location selector limited to server memberships, overview, settings screens. Shared `useRpcMutation` hook with request keys and uncertain-outcome checks.
- **Tests:** 63 pgTAP, 47 pilot integration, 15 demo integration, 26 unit, 7 e2e. AC01, AC02 and AC34 pass.

### Milestone 2: Complete restaurant transaction

- **Stock ledger (0009):** lots with use-by dates; balances per lot and condition, where reserved can never exceed on hand and nothing goes negative; weighted-average valuation; append-only movements; first-expiry-first-out reservation; one-time opening counts per location (use-by required in the pilot, gated by `perishables_confirmed`). The `opening_counts_posted` gate now checks for a posted count.
- **Purchasing (0010):**
  - owner maintenance of supplier terms and pack size/cost
  - POs go draft → submitted (gated by the supplier and pack gates) → partially received → received, or have their balance cancelled
  - receipts in packs or verified units, with actual pack cost, lot, use-by and packing-slip uniqueness
  - receipts validate fully before writing anything
- **Orders (0011):**
  - accept with price, tax, recipe and requirement snapshots, whole-order reservation and all-or-nothing shortage errors
  - edits as new revisions
  - kitchen start with expiry revalidation and a single issue at weighted-average cost
  - ready; recorded tenders with no overpayment; pickup only at zero balance (retail consumed at handover)
  - cancellation that releases stock before start, or records waste with manager approval after start
  - menu availability overrides
  - pickup codes `PRO-0001` per location per day; customer search/create
- **Reads and reports (0012–0013):** POS menu with independent portion counts and the limiting ingredient, stock overview (costs for managers only), role-scoped sales summary (operational, or demo historical), approver list.
- **Fix (0014):** `enable_posting` and `reopen_setup_gate` failed through the API because Supabase's safe-update guard requires a `WHERE` clause. Fixed in a new migration (ADR 0014).
- **Demo:** the 126 synthetic opening rows are now posted through the ledger.
- **Frontend:** Dashboard, POS, Kitchen, Inventory and Purchasing screens; manager PIN approval fields; a display-only money mirror; the unsent-draft cart; scanner rules; an error boundary; role-aware navigation.
- **Tests added:** pgTAP ledger suite (22), the **pilot operations** suite (28) that runs the full pilot setup through the real RPCs before testing transactions, demo operations (3), unit tests (9), e2e transaction flows (5).
- **ADRs 0009–0016:** approvals, receipt units, order revisions, cancelling with payments, demo opening stock, the safe-update fix, sales summary definitions, kitchen refresh.

### Milestone 3: Inventory and financial controls

Exit checks AC11–AC16, AC18, AC19, AC20 and the immutability part of AC31 all pass. The refund and AP clauses of AC07, AC09 and AC17, left open in Milestone 2, now pass as well.

- **Physical counts (0015, ADR 0020):**
  - A manager starts a count for every stocked item or a filtered set. It locks the balances, records the latest movement number for those items, and snapshots each lot and condition as the expected quantity.
  - Posting rejects the **whole** count (`conflict:stock_changed_since_count`) if any counted item moved after the snapshot.
  - Each difference posts one `count_adjustment` movement with the reason code (default `COUNT_VARIANCE`). Gains are valued at the current weighted average; losses issue at it (D11).
  - A count can never go below the quantity reserved on a lot, so accepted orders keep their stock. Blank lines are recorded as matching. Counts can be cancelled.
- **Waste reports (0015, 0019, ADR 0023):**
  - Employees and managers submit reports (items, quantities, optional lot, reason, note; `OTHER` needs a note). A report moves nothing.
  - A manager posts it, which removes **unreserved** stock only (quarantined first, then expired, then earliest use-by) at the weighted-average cost. Or the manager rejects it with a reason.
  - Employees see their own reports but never the cost. Cost columns are not granted to API roles, and `list_waste_reports` returns costs only to managers.
- **Quarantine (0015):** `change_stock_condition` moves part of a lot between `sellable` and `quarantined` with two linked `condition_change` movements. Quarantined stock stays on hand and valued but is never available or reservable. Releasing an expired lot is refused.
- **Transfers (0015, ADR 0021):**
  - draft → dispatched → partially received → received, or cancelled while still a draft.
  - Dispatch takes eligible, unreserved stock first-expiry-first-out at the source's average cost, one line per source lot. Stock is then in transit and available at neither location.
  - Only the destination's manager receives. Received stock becomes a new destination lot (keeping the source lot code and use-by) at the dispatch cost. Expired arrivals are forced into quarantine.
  - Losses need a transfer reason. Each line keeps received + lost + in transit = dispatched; a CHECK blocks over-receipt.
- **Refunds (0016, ADR 0017):**
  - Completed orders only, at the selling location. A manager's own session, or an employee with a manager PIN.
  - Refund by units or by net amount per line, computed from the line's snapshotted net (after its discount allocation) and tax, never current prices. The refund that reaches a line's last unit takes exactly the remainder.
  - Cumulative refunds can't exceed any line's recorded net and tax, or the order's recorded payments.
  - Each refund is a `MANUAL_EXTERNAL` (pilot) or `SIMULATED` (demo) record with its method, external reference, reason and approver. Meal refunds post no stock movement.
  - **Cancel with payment:** `cancel_order` now records the refund of a recorded payment in the same transaction, with manager approval and a refund method (supersedes ADR 0012).
- **Retail returns and custody (0016, ADR 0018):**
  - Retail lines only, from the original order, at the same location, within the policy window, up to units sold minus units already returned. Each returned unit is recorded with its condition (unopened/intact, opened, damaged), and the refund is optional.
  - Returned units go to a **held custody** record outside valued stock.
  - A manager **restocks** a held record only if the policy allows it, the unit is unopened and intact, and the item is shelf-stable retail. Restocking posts a `return_restock` movement on a new lot at the **original issue cost** and one COGS reversal (at most once per record). Otherwise the manager **disposes** of it with a note.
  - The owner sets the policy (`set_return_policy`). The `return_policy_configured` gate now requires one. The pilot starts with none, and restocking stays off unless the owner enables it.
- **Exchanges (0016, ADR 0019):** one transaction returns the units to custody, records an `exchange_credit` refund of their original value, and creates a replacement retail order (priced, taxed and reserved normally) paid by an `exchange_credit` tender. Any excess credit is paid out by the chosen method; any shortfall stays due. A fully covered replacement is handed over at once. If the replacement is short, nothing at all is recorded.
- **Supplier invoices and payables (0017, ADR 0022):**
  - Invoice lines match receipt lines (same supplier and location) or are charge lines such as freight. Quantity and price variances against the receipt are stored per line. An item without a receipt line is "unmatched".
  - Invoice numbers are unique per supplier after trimming and case folding, even with a new request key.
  - The due date defaults from supplier terms only once that supplier's gate is verified (always in demo); otherwise the invoice's due date must be entered.
  - A discrepancy blocks payment until a manager accepts it with a note. Corrections add a new line revision (old lines stay readable) and lapse the acceptance.
  - Payments and credits can't exceed the balance. Corrections are linked reversals. Status moves open → partially paid → paid. An invoice can be voided only with nothing applied, and its number stays reserved.
  - Overdue status uses the due date against the America/Denver business date. Invoices never post stock movements or change cost.
- **Reporting (0018):** the sales summary nets **sale refunds** (by refund date) out of net sales and tax, and nets **retail COGS reversals** out of COGS. It reports waste as post-start cancellations + posted waste reports + transit losses (transit losses belong to the source location), plus count variance, current inventory and in-transit value, and supplier outstanding and overdue balances (managers and owner only). Demo reset clears all the new tables.
- **Frontend:**
  - Inventory tabs for stock (with quarantine/release per lot), counts, waste reports and transfers.
  - **Refunds & returns** (order lookup; refund, retail return or exchange; returned-goods decisions), **Supplier invoices**, and **Settings → Return policy**.
  - New dashboard columns, and refund recording in the kitchen cancel form.
  - A shared reason-code picker. Error messages for every new server code.
- **Demo:** the seed adds a synthetic return policy (30 days, restock allowed, `synthetic_demo_policy`).
- **Tests added:**
  - pgTAP `005_controls` (27).
  - Pilot operations `m3-inventory-controls` (11) and `m3-refunds-ap` (16).
  - Demo `m3-demo-returns` (6).
  - e2e `controls.spec.ts` (6).
  - The Milestone 2 reconciliation test now nets refunds.
- **ADRs 0017–0023:** refund allocation, returns and custody, exchanges, count snapshots, transfers, supplier AP, waste reports.

### Milestone 4: Planning and staff tools

Exit checks AC21–AC28 all pass, and AC03 (permission enforcement) is now complete.

- **Schedules (0020, ADR 0027):**
  - Managers create shifts for staff with a membership at the location. Shifts are drafts until published, at most 16 hours long, and never overlap for the same employee across all locations (exclusion constraint; cancelled shifts free the slot).
  - Changing a published shift needs a reason; cancelling always does. Every step is audited.
  - Employees see only their own published shifts (RLS and `get_my_time_status`).
- **Clocking and breaks (0020, ADR 0027):**
  - `clock_in(location)`, `clock_out()`, `start_break()`, `end_break()` take no employee or time argument: the server uses the signed-in employee and its own clock. Employees can clock only at locations where they hold a role.
  - One open entry per employee across all locations (partial unique index plus a row lock); entries never overlap (exclusion constraint); clock-out is always after clock-in.
  - An entry is linked to a published shift that is in progress or starts within the hour; otherwise it is flagged **unscheduled** and kept.
- **Corrections (0020, ADR 0027):** a manager at the location (never for their own time) sets past clock times and breaks with a mandatory reason. An immutable `time_corrections` row keeps the original and new values. Overlaps, future times and reopening a closed entry are refused. Open entries stay visible as exceptions and are never auto-closed.
- **Hours report (0020):** elapsed UTC time minus recorded unpaid breaks, split at America/Denver midnight with DST handled (a fall-back night is 9 h = 2 + 7; a spring-forward night is 7 h = 2 + 5). Managers see the location; everyone else sees only their own hours.
- **Forecast (0021, ADR 0024):**
  - A 14-day plan per sellable item. Method: the same-weekday mean over the previous 8 complete weeks (including zero-sales open days); with fewer than 2 instances, the trailing 28-day mean; with no prior history, **manager forecast required**. Only dates before the as-of date are used, starting from the location's first sale.
  - Every value shows its method, observation count and window. Manager overrides are append-only, and the latest one wins.
  - On the current business date the forecast is reduced by orders fulfilled, in preparation and accepted, so their ingredients are not counted twice.
  - The pilot uses only operational orders. The demo can choose the synthetic history as an explicit, labeled source.
- **MRP projection (0021, ADR 0025):** each ingredient's daily balance = available stock (reservations and quarantine excluded) + PO receipts on their expected date − residual forecast × recipe quantity. Shortage = first day below safety stock. The proposed order date subtracts the supplier lead time and is flagged late if already past; the proposed quantity is pack-rounded. Late and undated POs are listed, not counted. A proposal is saved only as a normal draft PO.
- **EOQ and settings (0021, ADR 0026):**
  - `private.eoq(D, S, H)` in SQL (10,000 / $20 / $2 → 447.214, or 450 in 25-unit packs; H ≤ 0 and negatives rejected; D = 0 → 0). `calculate_eoq` returns the unconstrained EOQ, the pack-rounded actionable quantity and the cover-days cap separately, with warnings.
  - Estimated D comes from 180 days of fulfilled component use per observed open day × 365; under 28 days it is "insufficient" and a manager annual-demand input is used.
  - `set_location_item_settings` saves ROP, safety stock, S (cents), H (USD/base unit/year), max cover days and the demand input with unit labels and the approver. It needs the per-location `planning_inputs_confirmed` gate, which is now an owner attestation. Every save is audited.
- **What can we serve (0021, ADR 0028):** per dish, portions = floor(min available ÷ quantity per serving), with the limiting ingredient, today's order counts, planned demand (managers) and the next delivery, labeled as independent potentials. The manager **menu-mix preview** sums shared ingredients across dishes (for example 3 × FG-001 + 2 × FG-003 = 940 g chicken), shows shortages and pack-rounded replenishment, and writes nothing.
- **Labels (ADR 0029):** all 47 demo items (45 in the pilot) as Code 128 SVG labels with readable ID, name and base unit; category filter; a print stylesheet that prints only the labels; a scanner test field that reads keyboard-wedge input back and marks ingredients as not sellable.
- **Frontend:** Staff time, Planning (forecast, projection, settings), What can we serve and Labels screens. Denver wall-clock helpers convert form times to UTC across DST.
- **Tests added:**
  - pgTAP `006_staff_planning` (26).
  - Pilot operations `m4-staff-time` (8) and `m4-planning` (8).
  - Demo `m4-demo-planning` (2).
  - Unit `time.test.ts` (4).
  - e2e `staff-planning.spec.ts` (4).
- **ADRs 0024–0029:** forecast method, MRP projection, EOQ settings and the planning gate, clocking rules, serve view, labels.

---

## 9. Acceptance status after Milestone 4

| Check | Status | Note |
|---|---|---|
| AC01–AC29, AC34 | PASS | Milestones 1–4 (AC03 completed in Milestone 4) |
| AC30 | PARTIAL | Secret scan and base-path build pass; live GitHub Pages is an operator action (Milestone 5) |
| AC31 | PARTIAL | Immutability passes; the backup/restore drill is Milestone 5 |
| AC32 | PARTIAL | Every screen exists with full states; the tablet, keyboard-focus and scanner-hardware pass is Milestone 5 |
| AC33 | NOT_RUN | 20-session performance measurement (Milestone 5) |

---

## 10. Known limitations (current)

- **Recipe versions:** there is no UI to create new ones yet. Recipes are the source version 1.
- **Same-day orders:** there are no future-dated pickups, so forecast netting applies to the current business date only.
- **Planning:** a day without a forecast counts as zero demand and is flagged, never invented. Shelf life is never inferred: only the manager's max-cover-days caps quantities.
- **Returns:** refunds and returns are processed at the selling location only. An exchange with a balance still due leaves the replacement `ready` until it is collected.
- **Transfers:** a draft transfer reserves nothing, so dispatch can still fail on a shortage.
- **Supplier invoices:** receipt matching covers the last 180 days; there is no statement reconciliation or aging export.
- **Staff time:** schedules and time records only. No payroll, overtime rules, shift swaps or notifications.
- **Kitchen refresh:** the queue refreshes by polling every 10 s rather than Realtime (ADR 0016).
- **Bundle size:** about 743 kB (205 kB gzipped). Route-level code-splitting is a Milestone 5 candidate.
- **Not done:** live GitHub Pages deployment, hosted Supabase projects, the backup/restore drill, the performance measurement and the tablet/scanner hardware pass (Milestone 5 / operator direction).
