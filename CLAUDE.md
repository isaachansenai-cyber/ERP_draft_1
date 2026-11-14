# CLAUDE.md — Meats Around the World ERP (MVP pilot)

This file tells the coding agent how to build this repository. Read all of it before writing code, and re-read the relevant section before each milestone.

**Governing documents, in order of precedence:**

1. The operator's current instructions in the session.
2. This file's **Operator decisions** (§1). These resolve gaps the PRD leaves open.
3. `docs/spec/ERP_MVP_PRD.txt`, the product specification. The `.pdf` and `.docx` copies have the same content.
4. `docs/spec/ERP_AI_Build_Brief.txt`.
5. `docs/acceptance/Acceptance_Checklist.csv`, the 34 launch checks.

Cite PRD sections as `PRD §N`. If this file and the PRD disagree, this file wins only where §1 says so explicitly. Otherwise, stop and ask.

---

## 0. Ground rules (read every session)

- **The database is the system of record.** Every posting workflow is a single Postgres function (RPC) that does all of these in one transaction: validates input, authorizes, takes locks, checks state, enforces idempotency, writes business records and writes the audit entry. The React app never computes authoritative stock, cost, money or permissions.
- **The browser is untrusted.** Never ship or commit the service-role key, database passwords, real staff or customer data, or pilot exports. The frontend gets exactly two config values: the Supabase URL and the publishable (anon) key.
- **No fake modules.** No localStorage mock data, hardcoded dashboard totals, disabled-button placeholders or "TODO: call API" screens presented as working features (PRD §18). A screen counts as done only when its records persist, the server enforces authorization, retries are safe and the related reports reconcile.
- **No money moves.** No payment gateway, card fields, bank APIs or supplier e-mail/EDI. Tenders, refunds and supplier payments are records of something that happened outside the app (PRD §7, §9).
- **Never invent stock behavior, payroll rules, payment integrations or a different production model.** If you hit a scope-changing ambiguity not covered here, stop and ask the operator.
- **Never edit or delete posted stock or money rows.** Corrections are linked reversals or compensating entries.
- **Report honestly.** An acceptance check is `PASS` only with test evidence. Otherwise it is `FAIL`, `PARTIAL` or `NOT_RUN`, with a reason.
- **No external actions without operator direction.** Do not create Supabase or GitHub projects, deploy to GitHub Pages, invite users, contact suppliers or upload real data unless the operator says so in the session. Prepare everything locally and reviewably.
- Do not put any model or assistant identifiers in commits, code comments or docs.

---

## 1. Operator decisions (resolved gaps, binding)

| # | Topic | Decision |
|---|---|---|
| D1 | **Build priority** | **Pilot-first.** Every default is pilot-safe: tenders are `MANUAL_EXTERNAL`, customer-food restocking is off, monetary orders stay disabled until the tax rate and prices are confirmed, and there is no seed or reset path. Demo mode is a separately seeded variant of the same schema. It is required for tests and for AC02/AC23/AC34, but it is never the default. |
| D2 | **Pilot operating values** | Not available yet. Build **setup gates** (§7) that keep each dependent workflow disabled until the owner enters and confirms real values. Never copy demo values into a pilot database, even as placeholders. |
| D3 | **Milestones** | Follow PRD §18, milestones 1 through 5, strictly. Do not start the next milestone until the current one's exit tests pass (§10). |
| D4 | **Demo logins** | A **local-only Node script** (`scripts/demo/create-demo-users.ts`) creates Supabase Auth users for the 10 role fixtures in `demo_seed.json` and links their memberships. It uses the service-role key from a gitignored env file. It refuses to run unless both of these hold: (a) the target project ref is in `DEMO_PROJECT_REF_ALLOWLIST`, and (b) the database reports `data_mode = 'demo'`. It generates a random password per user on each run and writes them to the gitignored `DEMO_CREDENTIALS.local.md`. No passwords are committed or shared in the public repo. `docs/demo/README.md` explains how to run the script and where the credentials file appears. This script never runs against the pilot. |
| D5 | **Manager approval on shared tablets** | A **manager PIN override**. Owners and managers set their own PIN of at least 6 digits through an RPC while signed in. Only a bcrypt hash is stored (`pgcrypto` `crypt(..., gen_salt('bf'))`). Approval-requiring RPCs (discounts, post-start cancellation, over-receipt acknowledgement, discrepancy acceptance and refunds started on a shared terminal) take `p_approver_employee_id` and `p_pin`. The server checks the PIN hash, that the approver is an active owner, or a manager at the document's location, and the lockout counter: **5 failures lock the PIN for 15 minutes**. The PIN is never echoed, logged or cached on the client. The audit row records both the signed-in requester and the approving manager. |
| D6 | **Repository** | An existing GitHub repo supplied by the operator. Layout is in §3. The data package is committed under `docs/` and `data/`. It contains only synthetic fixtures plus the supplier contact details from the source documents, which are not verified. |
| D7 | **Test database** | A local Supabase stack via the Supabase CLI and Docker (both available). All integration tests run against this disposable stack and never against a hosted project. |
| D8 | **Perishables** (gap) | The source has no perishable flag. Add `items.requires_use_by boolean`. Seed it `true` for the 15 ingredients whose `storage_note` is "Refrigerated / frozen storage", and `false` otherwise, with provenance `derived_from_storage_note`. In the pilot this list is a setup gate the owner must confirm (§7). Demo data keeps the derived values. |
| D9 | **Operating calendar** (gap) | Add `location_closures(location_id, business_date, reason)`. A day is an "open day" unless it is listed there. A business date is the America/Denver calendar date, and the day boundary is local midnight. Forecasts and EOQ use this to count "open days with zero sales" (PRD §10). |
| D10 | **Pickup code** (gap) | `<LOC short>-<4-digit per-location, per-business-date sequence>`, for example `PRO-0042`. It is generated in the accept-order RPC, unique per (location, business_date). |
| D11 | **Weighted-average edge case** (gap) | If valued on-hand is ≤ 0 before a receipt, the new average cost equals the receipt unit cost. Count adjustments and non-order waste are costed at the current weighted average. |

---

## 2. Tech stack (fixed)

| Concern | Choice |
|---|---|
| Frontend | React 18, TypeScript (strict), Vite. **HashRouter** (React Router) so GitHub Pages refresh and deep links work. Vite `base` comes from `VITE_BASE_PATH` (for example `/<repo-name>/`). |
| Data fetching | `@supabase/supabase-js` v2 and TanStack Query. Writes go only through `supabase.rpc(...)`. The frontend never runs raw `insert`/`update`/`delete` on operational tables, and RLS denies it anyway. |
| Validation | Zod schemas mirror the RPC inputs for client-side UX only. The server validates again. |
| Styling | Tailwind CSS. Touch targets ≥ 44 CSS px, visible focus rings, and status shown as text plus color. |
| Barcodes | `jsbarcode` (Code 128, SVG). Print stylesheet via `@media print`. |
| Decimal math (client display only) | `decimal.js`. RPCs return quantities and unit costs as **text** wherever exact precision matters. Never parse them into JS floats for arithmetic. |
| Backend | Supabase Auth, Postgres 15+, RLS, PL/pgSQL RPCs, Realtime (kitchen refresh only). No Edge Functions unless the operator approves. No Next.js, no Python server. |
| Migrations | Supabase CLI (`npx supabase`, pinned as a devDependency). Versioned SQL files in `supabase/migrations/`. Never edit an applied migration; add a new one instead. |
| Types | `npx supabase gen types typescript --local > src/lib/database.types.ts`. Regenerate after every migration and commit the result. |
| Tests | **pgTAP** (`npx supabase test db`) for schema, constraint and RPC invariants. **Vitest** for pure TS (money allocation display, EOQ display, date splitting) and for **API integration tests** that sign in as real local Auth users through supabase-js, proving RLS and RPC authorization end to end. **Playwright** (preinstalled Chromium; never run `playwright install`; pass `--trace off`) for principal UI flows. |
| Lint and format | ESLint (typescript-eslint, react-hooks) and Prettier. `npm run typecheck` must be clean. |
| Package manager | npm. Commit `package-lock.json`. |

---

## 3. Repository layout

```
/CLAUDE.md
/README.md                         setup, dev, test and deploy overview
/.env.example                      VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_BASE_PATH, VITE_DATA_MODE_HINT (display only)
/docs/spec/                        ERP_MVP_PRD.txt|.pdf|.docx, ERP_AI_Build_Brief.txt, READ_ME_FIRST.txt,
                                   Source_Audit.txt, Data_Validation_Report.txt   (read-only reference)
/docs/acceptance/Acceptance_Checklist.csv   statuses and evidence updated by the agent
/docs/acceptance/ACCEPTANCE_REPORT.md       final report (Milestone 5)
/docs/ops/                         backup-restore.md, manual-outage-fallback.md, deployment.md, pilot-setup.md
/docs/demo/README.md               how to stand up the demo project and demo users
/docs/decisions/                   short ADRs for any choice not covered by the PRD or §1
/data/source/source_master_data.json        source-only normalization (45 items, 66 BOM, 15 suppliers)
/data/demo/demo_seed.json, historical_orders_demo.csv, historical_order_lines_demo.csv,
           history_method.json, seed_summary.json, ERP_Seed_and_Setup.xlsx      (DEMO ONLY)
/tools/demo-data/generate_demo_data.py      reference generator (seed 401); do not need to run
/supabase/config.toml
/supabase/migrations/              NNNN_<name>.sql
/supabase/tests/                   pgTAP *.test.sql
/scripts/import/                   import-source-master.ts (pilot + demo), import-demo-seed.ts, import-demo-history.ts
/scripts/demo/                     create-demo-users.ts, reset-demo.ts (allowlist-guarded)
/scripts/perf/                     20-session load script (Milestone 5)
/src/                              React app (see §8)
/tests/integration/                Vitest API/RLS/RPC tests against local stack
/tests/e2e/                        Playwright
```

`.gitignore` must include `.env*` (except `.env.example`), `DEMO_CREDENTIALS.local.md`, `supabase/.temp`, `*.dump`, `exports/` and `pilot-data/`.

---

## 4. Source data facts (verified against the delivered package)

- **Locations:** `LOC-PRO` Provo, `LOC-SFO` Spanish Fork, `LOC-SLC` Salt Lake City. All use America/Denver. "American Fork" in supplier notes is **not** a location.
- **Items:** 47 in total: `ING-001`…`ING-040` (40 ingredients), `FG-001`…`FG-005` (5 dishes, base unit `serving`), and `RET-001`/`RET-002` (synthetic retail sauces, base unit `each`, demo only). Base units are `g` (32), `ml` (6), `each` (4) and `serving` (5). The barcode is the item ID, type `CODE128_INTERNAL`.
- **Recipes:** 66 lines, split 12/16/14/17/7 across FG-001..005. **Preserve `quantity_per_serving` exactly.** Fractional `each` is allowed (FG-002 uses 3 tortillas (`ING-012`) and 0.5 lime (`ING-015`)).
- **Shared-ingredient example (AC05):** chicken `ING-001` is 180 g in FG-001 and 200 g in FG-003. So 3 × FG-001 plus 2 × FG-003 needs 940 g. Garlic is `ING-006`, used across several dishes (AC24).
- **Suppliers:** 15 records with non-contiguous IDs: `SUP-01, 02, 06, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19`. Never assume a range. `SUP-06`, `SUP-08`, `SUP-15`, `SUP-16` and `SUP-17` have no phone number. Keep those `NULL` and never fabricate a contact. Every supplier is `contact_verification = 'not independently verified'` and `pilot_verified = false`.
- **Lead times:** 21 ingredients are `Benchmark` and 19 are `Assumption`. None is a supplier quote, so label them in the UI.
- **Demo-only values** (in `demo_seed.json`, never imported into the pilot): pack sizes and costs, unit costs, sale prices (FG 1599/1399/1549/1999/2299 cents; RET 699/799), the 7.25% tax rate, supplier payment terms, `example.invalid` e-mails, 141 location/item settings, 126 opening rows (42 per location, no dish stock), 10 customers, 10 role fixtures (1 owner, plus 1 manager and 2 employees per location), and history (12,775 orders and 16,501 lines, 2026-05-01..2026-10-31, demo as-of date 2026-11-01).
- **Import verification targets** come from `data/demo/seed_summary.json`, including `historical_net_sales_cents = 30682004`.
- **Import by ID, never by display name.** Normalize `mL` to `ml` without changing quantities. Import scripts must be idempotent: upsert on source key, and reimporting changes nothing.

Two import paths, kept strictly separate:

- `import-source-master.ts` loads only `data/source/source_master_data.json`: items, recipes as version 1, suppliers, primary supplier links and lead times, all with provenance. It is allowed for both pilot and demo. In the pilot, imported records start **unverified**, so they show up on the setup-gate checklist.
- `import-demo-seed.ts` and `import-demo-history.ts` refuse to run unless the database's `app_settings.data_mode = 'demo'` and the project ref is allowlisted. History goes into `historical_sales_orders` and `historical_sales_lines` only, with no triggers into inventory, accounts payable (AP), tenders or timecards.

---

## 5. Database design rules

### 5.1 Conventions
- Schema `public` holds the exposed tables. Schema `private` holds helpers and secrets, such as PIN hashes and idempotency internals, and is not exposed through PostgREST.
- Business keys stay as text (`item_id = 'ING-001'`, `location_id = 'LOC-PRO'`, `supplier_id = 'SUP-06'`). Generated documents use `uuid` primary keys (`gen_random_uuid()`) plus human-readable numbers where useful.
- Quantities are `NUMERIC(18,6)`. Cost per base unit is `NUMERIC(18,8)`. Payable money is `BIGINT` cents. Never use `float`, `real` or `double precision` for money or quantities.
- All timestamps are `timestamptz` and are set server-side with `now()`. Clients never supply actor IDs, roles, authoritative costs, posting timestamps or clock times.
- Archive master data (`archived_at`) instead of deleting it. Foreign keys use `ON DELETE RESTRICT`.
- One company, three locations. No `tenant_id`. Operational rows carry `location_id`.

### 5.2 Required entities (PRD §14)
Identity: `locations`, `employees` (nullable `auth_user_id` unique, `display_name`, `active`), `memberships` (employee, role `owner|manager|employee`, location nullable for owner), `private.manager_pins`.
Master data: `items` (+ `requires_use_by`, `is_sellable`, provenance jsonb), `item_conversions` (verified only: from-unit, to-base factor, `verified_by`, `verified_at`), `purchase_packs`, `suppliers`, `supplier_items` (pack-to-base qty, cost, lead days, provenance, effective date), `location_item_prices` (effective-dated), `location_tax_rates` (effective-dated, `confirmed_by`/`confirmed_at`), `location_item_settings` (ROP, safety stock, S cents/order, H $/base unit/year, max cover days, all with a units column), `location_closures`, `reason_codes` (+ applicability flags, `requires_note`).
Recipes: `recipe_versions` (immutable once active), `recipe_components`.
Inventory: `lots` (supplier or internal lot, use-by date, condition `sellable|quarantined`), `inventory_movements` (**append-only**), `stock_balances` (projection per location/item/lot/condition, maintained by RPCs inside the same transaction, never written by clients), `item_valuation` (weighted-average per location/item), `reservations` and `reservation_allocations` (per lot), `stock_counts` and `stock_count_lines` (snapshot version), `waste_reports` (employee-submitted, manager-posted), `transfers` and `transfer_lines`, `return_custody` (customer-returned goods, **outside** valued on-hand).
Orders: `orders` (state, version int, pickup code, data-mode tender type), `order_lines` (price, discount allocation, tax snapshot, `recipe_version_id`), `order_line_requirements` (snapshotted BOM explosion), `order_state_events`, `tenders`, `refunds` and `refund_lines`, `returns`, `return_lines`, `exchanges`.
Purchasing: `purchase_orders` and lines, `receipts` and `receipt_lines`, `supplier_invoices` and lines, `invoice_receipt_matches`, `supplier_payments`, `supplier_credits`. Reversals are linked rows.
Staff: `shifts` (draft/published/cancelled), `time_entries`, `break_intervals`, `time_corrections` (immutable).
Planning: `forecast_overrides`, `replenishment_proposals` (draft only).
Demo history: `historical_sales_orders` and `historical_sales_lines` with `dataset_id` and `UNIQUE(dataset_id, source_key)`.
Platform: `app_settings` (singleton row: `data_mode 'pilot'|'demo'`, set **only** by a migration or an owner RPC guarded as in §7), `pilot_setup_gates`, `request_log` (idempotency), `audit_log`.

### 5.3 Invariants enforced in the database (not the client)
- `inventory_movements`: revoke `UPDATE`/`DELETE` from `anon` and `authenticated`, plus a trigger that raises on update or delete for every role except migrations. This is AC31.
- Available quantity is `eligible sellable on-hand − active allocations on eligible lots`, and it never goes below 0. Eligible means `condition = 'sellable'` and (`use_by_date IS NULL` or `use_by_date >= current local business date`). Back this with a CHECK or trigger on the projection plus RPC checks.
- On-hand is never below quarantined plus active reservations.
- The unique constraints in PRD §14 apply. Supplier invoice numbers are unique on `(supplier_id, lower(btrim(invoice_number)))`. Use a partial unique index for one open `time_entry` per employee. Use exclusion constraints (`btree_gist`, `tstzrange`) so shifts and closed time entries for the same employee cannot overlap.
- Recipe version rows are immutable once `status = 'active'`, enforced by a trigger.
- Transfer reconciliation: `received + lost + in_transit = dispatched` per line, checked in the RPC and by a CHECK on the line totals.

### 5.4 RPC contract template (every posting workflow)
```
create function public.<verb>_<noun>(p_request_key uuid, p_expected_version int /* if editing */, ...)
returns jsonb
language plpgsql
security definer            -- only when RLS-bypass is genuinely needed; else security invoker
set search_path = ''        -- fixed; schema-qualify everything
as $$
  -- 1. idempotency: select from private.request_log where (actor, rpc_name, request_key);
  --    if found, return the stored result unchanged
  -- 2. resolve actor from auth.uid() -> employees/memberships; raise 'unauthorized' if not permitted
  --    for THIS location (derive location from the document, never trust a client location arg alone)
  -- 3. setup-gate check (pilot) -> raise 'setup_gate_closed:<gate>'
  -- 4. validate input (positive whole servings, units, reason codes, OTHER needs note)
  -- 5. lock rows in a consistent order: ORDER BY location_id, item_id, lot_id ... FOR UPDATE
  -- 6. state/version check -> raise 'conflict:stale_version' / 'invalid_state:<from>-><to>'
  -- 7. business writes (movements, projections, document state, snapshots)
  -- 8. audit_log write (actor, approver if PIN, action, object, location, request_key, before/after)
  -- 9. store result in private.request_log; return result
$$;
revoke all on function ... from public, anon;
grant execute on function ... to authenticated;
```
- Error codes are stable machine strings (`insufficient_stock`, `unauthorized`, `conflict:stale_version`, `setup_gate_closed:<gate>`, `duplicate_business_key:<what>`, `invalid_state:...`, `pin_invalid`, `pin_locked`, `validation:<field>`). The UI maps each to an actionable message. `insufficient_stock` must name the bottleneck item(s) and the shortfall.
- The idempotency scope is (actor employee, RPC name, request key). A new key never bypasses business uniqueness checks (receipt external reference, invoice number).
- Provide `public.get_request_result(p_request_key uuid)` so the client can check an action whose outcome is uncertain (AC29).
- Reporting reads use `security_invoker = true` views or authorized `security definer` functions that filter by membership. Cross-location manager summaries expose **only** aggregated sales totals and item availability (AC03).
- Run `npx supabase db lint` and check the Supabase security advisor after each migration. Fix every "RLS disabled", "security definer view" and "mutable search_path" finding.

### 5.5 Money rules (PRD §7)
- Discount before tax. An order-wide discount is allocated across lines in proportion to line gross, using **largest remainder** in cents, with ties broken by stable line order.
- Tax per line is `round_half_up((line_gross − line_discount) × rate)` to cents. The rate comes from the location rate effective at acceptance and is snapshotted on the line.
- A refund uses the line's snapshotted price, discount and tax, never current values. The cumulative refund per line and per order cannot exceed the recorded amounts.
- Completion requires recorded tender ≥ total due, with a balance due of 0. The exception is a manager-approved (PIN) zero-value order with a 100% discount and a reason.
- Tender types are `SIMULATED` in demo and `MANUAL_EXTERNAL` in pilot, and the server picks the type from `app_settings.data_mode`. UI copy says "Recorded payment" (pilot) or "Simulated payment" (demo), never "Paid" or "Settled".

### 5.6 Inventory flow summary (PRD §6, §7, §8)
| Event | Effect |
|---|---|
| Accept order | Explode the BOM across the **whole order** (aggregate shared ingredients), and reserve allocations FEFO: earliest use-by first, then receipt time, with undated lots last. Reserve retail units too. All-or-nothing. |
| Edit accepted order | Version-checked. Release and re-reserve atomically. |
| Kitchen start | Revalidate lot eligibility and reassign expired allocations, or block. Consume the reserved ingredients **once** at the weighted-average issue cost snapshot. Release the reservations. Recipe edits are locked from here on. |
| Ready → Completed | No further ingredient issue. Retail units are consumed at handover. Requires tender rules (§5.5). |
| Cancel before start | Release reservations. Employees may do this (audited). |
| Cancel after start | Manager PIN plus reason. Reclassify the already-issued cost as waste. No stock is added and nothing is issued twice. |
| Receipt | Version- and idempotency-checked. Quantity in base units is `packs × snapshotted pack_base_qty`. Recompute the weighted average. Over-receipt needs a manager PIN plus an audit entry. In the pilot, a `requires_use_by` item needs a use-by date. |
| Invoice | Never touches stock or cost. Variances are shown, never revalued. |
| Retail return | A quarantine custody record outside valued stock. Demo-only restock release restores the original issue cost and reverses that COGS once. The pilot restock policy is **disabled** until configured (gate). |
| Exchange | Return plus replacement sale in one transaction. If the replacement is short, nothing posts. |

---

## 6. Authorization matrix (summary of PRD §4, enforced server-side)

- **Owner:** everything, all locations, including memberships, company catalog and recipe versions, setup gates and demo reset (demo only).
- **Manager:** full operational control at assigned location(s). Reads other locations' **aggregated sales totals and availability only**. No membership writes. Approves discounts, post-start cancellations, over-receipts, discrepancies, refunds, returns and exchanges at their own location.
- **Employee:** POS and kitchen at assigned location(s); cancel an unstarted order (audited); submit waste *reports*; own published shifts; own clock in/out; minimal customer lookup and create for an order; own-location daily sales summary. **No** costs, margins, customer lists, discounts, refunds, invoices, exports or permission edits.
- A frontend role selector or a client-sent `location_id` never grants access. The location selector only filters among locations the server says the user may access.
- Every row of this matrix needs at least one **negative** API integration test, where the forbidden caller gets `unauthorized` or zero rows.

---

## 7. Pilot setup gates (D1/D2)

`pilot_setup_gates(gate_key, location_id nullable, status 'open'|'confirmed', confirmed_by, confirmed_at, evidence_note)`. Only the owner can confirm a gate, via RPC, and confirming one is audited. In demo mode every gate is pre-confirmed by the seed and labeled synthetic.

| Gate | Blocks until confirmed |
|---|---|
| `roles_verified` | Any operational posting (verified by direct API tests on real Auth users) |
| `supplier_master_verified` (per supplier) | Submitting POs to that supplier; due-date defaults from its terms |
| `pack_conversions_verified` (per supplier_item) | Receiving in packs for that relation (base-unit receipt still allowed by a manager) |
| `recipes_verified` (per dish) | Selling that dish (recipe version must be pilot-verified) |
| `menu_prices_confirmed` (per location) | Monetary order acceptance at that location |
| `tax_rate_confirmed` (per location) | Monetary order acceptance at that location |
| `perishables_confirmed` | Pilot receipts (the `requires_use_by` list must be reviewed) |
| `return_policy_configured` | Retail returns; restock release stays disabled unless explicitly enabled |
| `opening_counts_posted` (per location) | POS acceptance at that location |
| `planning_inputs_confirmed` (per location) | Saving ROP/EOQ settings as approved (previews still allowed) |
| `backup_restore_tested` | Final `posting_enabled` switch |
| `acceptance_suite_passed` | Final `posting_enabled` switch |

The **Settings → Pilot setup** screen lists every gate with its status, who confirmed it and when, and links to the screen where the value is entered. RPCs raise `setup_gate_closed:<gate>`, and the UI explains what is missing. Never auto-confirm a gate.

**Pilot database safety:** the pilot has no seed or reset RPC, no demo import, and `data_mode = 'pilot'` set by migration. `reset-demo.ts` and the demo importers must check (a) the project ref against `DEMO_PROJECT_REF_ALLOWLIST` (an env var, never a CLI argument) and (b) `app_settings.data_mode = 'demo'`, and abort otherwise. Test both refusals (AC02).

---

## 8. Frontend rules

- Screens are listed in PRD §13. Route map (hash): `#/login`, `#/dashboard`, `#/pos`, `#/kitchen`, `#/inventory`, `#/catalog`, `#/purchasing`, `#/invoices`, `#/returns`, `#/planning`, `#/serve` (What can we serve), `#/staff`, `#/customers`, `#/labels`, `#/settings`.
- **A persistent header** shows the location, the signed-in user's role and a **data-mode banner**: "PILOT — real data" or "DEMO — synthetic data". The banner reads `app_settings.data_mode` from the server and never from an env flag.
- **Every write screen** has loading, empty, validation, unauthorized, conflict (stale version, with a refresh-and-retry path), network-failure and success states (AC32). Build a shared `useRpcMutation` hook that:
  - generates a `request_key` per user intent and keeps it in `sessionStorage` until resolved;
  - disables the submit button while a request is in flight;
  - on a timeout, network error or session expiry, shows "Not confirmed — checking…" and calls `get_request_result` before offering a retry with the **same** key;
  - never shows success before the RPC returns.
- **When offline**, posting buttons are disabled and a banner says "No connection — nothing was saved." The POS cart draft persists locally, labeled "Unsent draft", and is never shown as an accepted order.
- **POS:**
  - The barcode or keyboard-wedge input field is always focusable.
  - Scanning an `ING-*` code shows "Ingredient — not sellable" and does not add a line (AC28).
  - Quantities are whole numbers ≥ 1.
  - Availability comes from the server.
  - Discounts and approvals open the manager PIN dialog.
- **Kitchen:** a per-location queue (accepted, preparing, ready) with explicit start, ready and complete actions, order age and ETA. Prep lead-time notes are shown as context. Realtime only triggers a refetch.
- **Labels:** all 47 items, filterable by category, as Code 128 SVG with the readable ID, name and base unit. Includes a print stylesheet and a "scanner test" input that echoes the decoded ID.
- **Reports:** every report shows the location scope, local date range, data source (pilot operational, demo operational or demo historical), currency (USD) and last-refresh time. A zero denominator displays "—". CSV export calls the same authorized function as the screen.
- **Display:** times in America/Denver using `Intl.DateTimeFormat`. Dates sent to RPCs are local business dates (`YYYY-MM-DD`); the server converts.
- **Labels on assumption-based values:** show badges for source, benchmark estimate, assumption, synthetic demo and unverified.

---

## 9. Planning, EOQ and "What can we serve" (PRD §10)

- **Forecast:** a 14-day plan per location with an as-of date.
  - The method is the same-weekday mean over the previous 8 complete weeks, counting zero-sales open days (D9).
  - If there are fewer than 2 weekday instances, fall back to a trailing 28-day mean.
  - With no history, require a manager forecast.
  - Each forecast shows its method, observation count, window and any override.
  - **Pilot** forecasts use only pilot operational orders. **Demo** forecasts may use `historical_sales_*`, explicitly labeled.
- **Netting:** start from available stock (which already excludes reservations and quarantine). Subtract accepted-but-unconsumed order quantities from the forecast **before** exploding the BOM (AC21). Fulfilled orders reduce same-day remaining demand. Open POs count only on their expected date, and late ones are flagged.
- **Projection:** per ingredient per day, `prior + scheduled receipts − uncovered requirements`, compared against safety stock and ROP. A proposed order date is the shortage date minus the supplier-item lead days, marked late if it falls in the past. Proposals become draft POs only on explicit save.
- **EOQ:** `sqrt(2DS/H)`, with D in base units per year, S in $ per order and H in $ per base unit per year.
  - Block the calculation when D < 0, S < 0 or H ≤ 0. Return 0 when D = 0 and H > 0.
  - D comes from the last 180 complete days of fulfilled component use ÷ open days × 365. Below 28 days, mark it "insufficient" and require manager input.
  - Show unconstrained EOQ and the pack-rounded actionable quantity separately; apply the cover-days cap with a warning.
  - Test vector: D = 10,000, S = 20, H = 2 gives 447.214, which rounds to 450 with 25-unit packs (AC22). Implement it as a SQL function and unit-test it in pgTAP. A TS mirror is for display only.
- **What can we serve:**
  - Per dish, portions = `floor(min over components(available ÷ qty_per_serving))`, with the bottleneck ingredient, current vs. planned demand and next expected delivery.
  - Label these as **independent** potentials that are not additive.
  - The menu-mix simulator aggregates shared components (chicken `ING-001`, garlic `ING-006`) and shows combined shortages and proposed replenishment as a preview. Nothing is saved without an explicit action (AC24).
  - Pure SQL/TS, no external AI API.

---

## 10. Milestones and exit criteria (D3)

Work in this order. At the end of each milestone, update `docs/acceptance/Acceptance_Checklist.csv` (status plus an evidence pointer, such as a test file and test name) and write a short progress note in `docs/acceptance/PROGRESS.md`.

1. **Foundation:** scaffold (Vite app, Supabase CLI, lint, typecheck and test scripts); migrations for identity, master data, recipes, app_settings, setup gates, request_log, audit_log and RLS; the source-master importer; the demo seed and history importers (guarded); the demo-user script; login, location selector and data-mode banner.
   *Exit:* AC01, AC02, AC03 (membership/location basics), AC30 (secret scan of `dist/` and the repo) and AC34 pass.
2. **Complete restaurant transaction:** PO → partial receipt → stock → POS accept (reservation) → kitchen start (issue) → ready → complete (tender) → dashboard metrics. Build the vertical slice end to end before widening any screen.
   *Exit:* AC04–AC10, AC17, AC20 (sales part) and AC29 pass.
3. **Inventory and financial controls:** counts, waste, transfers, lots/expiry, returns/exchanges, refunds, supplier invoices, payments, credits and reversals.
   *Exit:* AC11–AC16, AC18, AC19, AC20 (waste part) and AC31 (immutability part) pass.
4. **Planning and staff tools:** forecast, BOM explosion, MRP projection, ROP/EOQ, What can we serve, labels, shifts, clocking, corrections and the hours report.
   *Exit:* AC21–AC28 pass.
5. **Pilot readiness:** full acceptance run, tablet/keyboard/scanner pass, a performance measurement with 20 sessions (AC33), a backup/restore drill in a disposable project (AC31; documented, run only with operator direction for hosted projects, otherwise against local), deployment docs, the pilot setup runbook and `ACCEPTANCE_REPORT.md`.
   *Exit:* every AC is PASS, or is explicitly listed with a reason the operator accepts.

---

## 11. Testing requirements

- **Persisted invariants need database-level tests.** Frontend-only tests don't count (PRD §17).
- **Required test cases:**
  - **AC05 shared ingredient:** with 2,000 g `ING-001` available, 3 × FG-001 plus 2 × FG-003 reserves 940 g, leaves 1,060 g, and kitchen start consumes exactly 940 g once.
  - **AC06 concurrency:** two independent DB connections (two `pg` clients or two signed-in supabase-js clients fired with `Promise.all`) compete for the last portion. Exactly one succeeds, the other gets `insufficient_stock`, and no partial allocations remain.
  - **AC07 retries:** call each of accept, kitchen start, receipt, refund and payment twice with the same key. Row counts are unchanged and the result is identical.
  - **AC25 clocking:** two concurrent clock-ins produce at most one open entry.
  - **AC27 timezone:** an overnight entry across the 2026-11-01 DST fall-back (America/Denver) and one across 2027-03-14 spring-forward give the correct elapsed hours and local-day splits.
  - **AC03 permissions:** at least one negative test per authorization-matrix row, run as real local Auth users (employee, manager at another location).
  - **AC30 secrets:** after `npm run build`, grep `dist/` and the tracked files for `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, JWTs with `"role":"service_role"`, `postgres://` and passwords. The test fails on any hit.
- **Test fixtures:** tests build their own minimal fixtures through RPCs, or load the demo seed into the **local** stack. Never point tests at a hosted project.
- **Commands** (keep these names in `package.json`): `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:db` (pgTAP), `npm run test:integration`, `npm run test:e2e -- --trace off`, `npm run db:start`, `npm run db:reset` (local only), `npm run db:types`, `npm run import:source`, `npm run import:demo`.
- **Before declaring any task done**, run typecheck, lint, unit, db and integration tests. Show the failures if any remain.

---

## 12. Working style for the agent

- Small, reviewable commits, one concern each, with a descriptive message. Do not push or open PRs unless the operator asks.
- Write the migration and its pgTAP test before the UI that depends on it.
- If you make a decision the PRD and §1 don't cover, write a 5–10 line ADR in `docs/decisions/` and mention it in your progress note. If the decision changes scope, ask first.
- Keep `README.md` accurate: prerequisites, local stack startup, imports, demo users, tests, build and Pages deployment (`VITE_BASE_PATH`, hash routing).
- Don't refactor working, tested code during a later milestone unless a test demands it.
- When unsure whether something counts as "inventing stock behavior", stop and ask.

---

## 13. Explicitly out of scope (PRD §19)

Payroll, wages and taxes; general ledger and accounts receivable; bank and payment integrations; customer self-ordering or logins; table management; loyalty and marketing; maintenance; batch or prepared-food stock; substitutions, modifiers and nested recipes; autonomous supplier ordering or e-mail; camera scanning; offline sync; multi-currency; tips and split tenders; cash-drawer reconciliation; delivery marketplaces; partial fulfillment and item-level post-start cancellation. Exact coverage of the 12-item grading rubric is **unverified** because the rubric text was not supplied, so do not claim it.
