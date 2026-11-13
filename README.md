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
| [`docs/decisions/`](docs/decisions/) | ADRs 0001–0016 for choices the PRD leaves open |
| [`docs/ops/pilot-setup.md`](docs/ops/pilot-setup.md) | Pilot setup runbook |
| [`docs/demo/README.md`](docs/demo/README.md) | Demo project setup and demo logins |
| [`docs/ops/deployment.md`](docs/ops/deployment.md) | GitHub Pages and Supabase deployment notes |

---

## 1. Status

| Milestone | Scope | State |
|---|---|---|
| 1 Foundation | Schema, Auth/roles, RLS, pilot/demo separation, setup gates, importers, app shell | **Done** |
| 2 Complete restaurant transaction | Purchasing → partial receipt → stock → POS (reservation) → kitchen (issue) → ready → payment → pickup → dashboard | **Done** (see §9 for which acceptance checks fully pass) |
| 3 Inventory & financial controls | Counts, waste, transfers, returns/exchanges, refunds, supplier invoices/payments | Not started |
| 4 Planning & staff tools | Forecast/MRP, ROP/EOQ, "What can we serve", labels, schedules, clocking | Not started |
| 5 Pilot readiness | Full acceptance run, performance, backup/restore, deployment | Not started |

Acceptance checklist today: **9 PASS, 10 PARTIAL, 15 NOT_RUN**. Each PARTIAL lists exactly what remains and which milestone delivers it.

---

## 2. What the app does today

### Screens (hash routes)

| Route | Who | What it does |
|---|---|---|
| `#/login` | everyone | Staff sign-in. No self sign-up. The data-mode banner (PILOT/DEMO) comes from the server. |
| `#/` Overview | all staff | Signed-in identity, location and role, business date, posting status, open setup gates |
| `#/dashboard` | all staff (scoped) | Sales summary per location: completed orders, gross sales, discounts, refunds, net sales, tax, recorded payments, average order value, COGS, gross margin, waste, pending prep cost, low-stock items, fulfillment time, cancellations. Date range, location scope and (demo only) a historical data source. CSV export uses the same server function. |
| `#/pos` | staff at the location | Menu with live "available now" counts and the limiting ingredient, plus a barcode/keyboard-wedge input. Scanning `ING-*` shows "Ingredient — not sellable". The cart is kept as a labeled **unsent draft**. Also: optional customer search/create, pickup name, kitchen note, manager-approved discount (with PIN dialog for employees), an estimated total, **Accept order**, then record the payment. |
| `#/kitchen` | staff at the location | Queue in three columns (accepted, preparing, ready) showing pickup code, name, items, age, ETA and prep notes. Explicit **Start preparation**, **Mark ready** and **Complete pickup** (blocked until the balance due is 0). **Cancel** releases stock before start; after start it records waste with manager approval. Refreshes every 10 s. |
| `#/inventory` | staff (costs: managers) | Per item: on hand, reserved, quarantined, available, expired, lots with use-by. Average cost and value for managers. One-time **opening count** form. Menu availability on/off switches for managers. |
| `#/purchasing/orders` | managers, owner | Create a draft PO from the supplier's pack list, submit it (placed outside the app), **receive** actual packs with lot, use-by and actual pack cost, acknowledge over-receipts, close the open balance |
| `#/purchasing/suppliers` | managers view, owner edits | Supplier contacts (unverified, missing phones left blank), payment terms, pack size and cost per supplier item (quoted/estimated), with provenance badges |
| `#/settings/setup` | all view, owner acts | Pilot setup gates with status, who confirmed and evidence. Confirm/reopen. Enable posting. |
| `#/settings/taxes-prices` | owner (tax), managers (prices) | Effective-dated tax rates and menu prices. Past values can never be rewritten. |
| `#/settings/staff` | owner (managers view) | Staff records, link invited sign-in accounts, grant/revoke roles |
| `#/settings/account` | owners, managers | Set the manager approval PIN |

Every write screen shows loading, empty, validation, unauthorized, conflict (stale version), offline and success states. An error boundary prevents blank screens. Touch targets are at least 44 px, focus is visible, and status is shown as text as well as color.

### How a sale moves stock and money

1. **Receipt.** A manager receives packs against a submitted PO. Base quantity = packs × the snapshotted pack size, or a quantity in a verified unit. Each receipt creates a lot (with use-by), a `receipt` movement, a balance increase and a new weighted-average cost: *(old qty × old cost + received qty × receipt cost) ÷ new qty*. If valued stock was zero or less, the receipt cost becomes the average. Partial receipts leave the rest open. A retry with the same request key adds nothing. Over-receipts need an acknowledgement and are audited.
2. **Accept order** (POS). Prices, the tax rate and the active recipe version are snapshotted on each line, and the recipe is exploded into per-line requirements. Requirements are **aggregated across the whole order**, every item is checked, and stock is reserved **first-expiry-first-out** (earliest use-by, then receipt time, undated last). Expired and quarantined stock is never used. If anything is short, nothing is reserved, and the error names the ingredient and the shortfall.
3. **Start preparation** (kitchen). Lots are rechecked (an expired reservation is reassigned, or the start is blocked). The reserved ingredients are then **consumed once** at the weighted-average cost, which is recorded per order.
4. **Ready → pay → complete pickup.** No ingredient is issued again. Retail items are consumed at handover. Completion requires recorded payment = total, or a manager-approved 100% discount.
5. **Cancel.** Before start, the reservations are released. After start, a manager approves (in person or by PIN) and the issued cost is recorded as **waste**. Nothing is restocked or issued twice.

Money rules:
- Integer cents throughout.
- The discount is applied before tax, allocated across lines by largest remainder (ties by line order).
- Tax is rounded half up per line.
- Net sales = gross − discounts − refunds, with tax separate.
- COGS comes from issue-cost snapshots. Post-start cancellations appear only in waste.

### Pilot vs demo

- **Pilot** (default): payments are `MANUAL_EXTERNAL`. Nothing operational works until the owner confirms the setup gates and enables posting. Synthetic data is rejected by database triggers.
- **Demo**: a separate project switched to demo mode while empty. It has synthetic fixtures (47 items, 10 customers, 10 role logins, synthetic prices, packs, terms and tax, 126 opening-stock rows posted through the ledger) and six months of read-only synthetic sales history (12,775 orders, $306,820.04 net). Payments are `SIMULATED`.

---

## 3. Architecture and security

- **The database is the system of record.** Each posting workflow is one `SECURITY DEFINER` function with a fixed empty `search_path`. In a single transaction it authorizes `auth.uid()` against memberships and checks the setup gates. It then validates, takes row locks in a consistent order, checks state and version, and enforces idempotency. Finally it writes the business rows and the audit row.
- **API roles can only SELECT**, filtered by RLS. They have no INSERT, UPDATE or DELETE on any table. `anon` can call only `get_public_app_mode`.
- **Append-only:**
  - inventory movements, lots, opening counts, receipts, tenders, order lines and events, issue costs, cancellation waste
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

### RPCs available to signed-in staff (each authorizes server-side)

| Area | RPCs |
|---|---|
| Context and setup | `get_public_app_mode`, `get_my_context`, `get_request_result` |
| Staff access | `list_staff_access`, `create_employee`, `link_employee_auth_user`, `set_employee_active`, `grant_membership`, `revoke_membership`, `set_manager_pin`, `list_location_approvers` |
| Gates and posting | `confirm_setup_gate`, `reopen_setup_gate`, `enable_posting` |
| Prices, taxes, menu | `set_location_tax_rate`, `set_location_item_price`, `set_menu_availability`, `get_pos_menu` |
| Suppliers and purchasing | `set_supplier_terms`, `set_supplier_item_pack`, `create_purchase_order`, `submit_purchase_order`, `receive_purchase_order`, `cancel_purchase_order_balance` |
| Stock | `post_opening_count`, `get_stock_overview` |
| Orders | `accept_order`, `edit_accepted_order`, `start_order_preparation`, `mark_order_ready`, `record_tender`, `complete_order_pickup`, `cancel_order`, `search_customers`, `create_customer` |
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
| `npm run test:unit` | Money mirror (largest remainder, half-up tax), cart and scanner rules, draft storage, error messages, request-key retry logic, tooling guards, secret scanner | 35 |
| `npm run test:db` | Resets the local DB, then runs pgTAP: grants, RLS, search_path, synthetic guards, immutability, recipes, units, gates, idempotency, PIN lockout, demo switch, **ledger** (first-expiry-first-out, availability, weighted average, constraints, append-only) | 85 |
| `npm run test:integration` | Three suites as real local Auth users through the API: **pilot** (AC01, AC02, AC03, retries, gates), **pilot operations** (full pilot setup via RPCs, then AC04–AC10, AC17, AC20 and cross-location permissions), **demo** (AC02, AC34, demo logins, reset reproducibility, opening stock, retail and simulated payments, historical source) | 47 + 28 + 18 |
| `npm run test:e2e` | Production build under `/ERP_draft_1/`: sign-in, deep-link reload, role-scoped UI, offline, lost responses and expired sessions on real order RPCs, the POS → kitchen → pickup → dashboard flow, purchasing with a partial receipt | 12 |
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
supabase/migrations/   0001–0014 (see §3)
supabase/tests/        pgTAP: 001 schema security, 002 invariants, 003 demo mode + PIN, 004 ledger
scripts/import/        import-source-master, import-demo-seed (posts demo opening stock), import-demo-history
scripts/demo/          init-demo-database, create-demo-users, reset-demo (allowlist + demo-mode guarded)
scripts/security/      scan-secrets (AC30)
src/                   React app: auth/, components/ (shell, UI kit, approval fields, error boundary),
                       lib/ (rpc, retry-safe mutation hook, money mirror, POS draft, formatting), pages/
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

---

## 9. Acceptance status after Milestone 2

| Check | Status | Note |
|---|---|---|
| AC01, AC02, AC34 | PASS | Milestone 1 |
| AC04, AC05, AC06, AC08, AC10, AC29 | PASS | Milestone 2 |
| AC07 | PARTIAL | Acceptance, kitchen start, receipt and payment retries pass; the refund retry comes with refunds (Milestone 3) |
| AC09 | PARTIAL | Requirements and totals stay snapshotted; refund calculations come in Milestone 3 |
| AC17 | PARTIAL | Tenders are recorded/simulated only and pickup needs a zero balance; refund and AP records come in Milestone 3 |
| AC20 | PARTIAL | Sales, tax and waste reconcile; refunds are 0 until Milestone 3 |
| AC03, AC12, AC28, AC30, AC31, AC32 | PARTIAL | Scope so far passes; remaining parts listed in the checklist |
| Others | NOT_RUN | Milestones 3–5 |

**Why some Milestone 2 checks are PARTIAL:** AC07, AC09, AC17 and AC20 each include a refund (and for AC17, supplier AP) clause. CLAUDE.md §10 schedules refunds and supplier invoices for Milestone 3. Everything else in those checks passes.

---

## 10. Known limitations (current)

- **Refunds:** an order with a recorded payment can't be cancelled until refunds exist (Milestone 3, ADR 0012).
- **Recipe versions:** there is no UI to create new ones yet (owner workflow later). Recipes are the source version 1.
- **Not yet built:** counts, waste reports, transfers, quarantine moves, returns/exchanges, supplier invoices, planning, labels, schedules and clocking (Milestones 3–4).
- **Dashboard:** it doesn't yet show supplier balances, worked hours or waste-report detail.
- **Kitchen refresh:** the queue refreshes by polling every 10 s rather than Realtime (ADR 0016).
- **Bundle size:** about 569 kB (166 kB gzipped). Code-splitting is deferred.
- **Not done:** live GitHub Pages deployment, hosted Supabase projects, backup/restore drill and the performance measurement (Milestone 5 / operator direction).
