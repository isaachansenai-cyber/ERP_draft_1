# Progress notes

## Milestone 1 — Foundation (2026-11-13)

**Exit criteria (CLAUDE.md §10):** AC01, AC02, AC03 (membership/location basics), AC30 (secret scan) and AC34. All are met:

| Check | Status in checklist | Milestone 1 portion |
|---|---|---|
| AC01 Source import | PASS | Complete |
| AC02 Demo segregation | PASS | Complete. Demo opening stock is posted in Milestone 2 (ADR 0005) |
| AC03 Permission enforcement | PARTIAL | Memberships, location scoping, staff, gates, taxes, prices, costs and visibility pass. Refund/discount/invoice/report rows come with those modules |
| AC30 Hosting and secrets | PARTIAL | Secret scan passes for the repo and the bundle. Base-path login and refresh verified on a local static preview. Live GitHub Pages not deployed (needs operator direction) |
| AC34 Historical import integrity | PASS | Complete |

Groundwork already verified for later checks: AC04, AC07, AC09, AC29, AC31 and AC32 are marked PARTIAL, each with evidence in the checklist.

### Test evidence (final full run)

| Suite | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm run test:unit` | 26 passed |
| `npm run test:db` (pgTAP, fresh pilot database) | 63 passed |
| `npm run test:integration` | pilot 47 passed, demo 15 passed |
| `npm run build && npm run test:secrets -- --require-dist` | passed |
| `npm run test:e2e` | 7 passed |
| `supabase db lint --level warning` | no findings |

### Delivered

- **Migrations `0001`–`0008`:** platform, identity, master data, recipes, setup gates, demo history, RLS, identity/setup RPCs and demo-mode controls.
- **Tooling:** `scripts/import/*` (source master, demo seed, demo history), `scripts/demo/*` (init, users, reset) and `scripts/security/scan-secrets.mjs`.
- **App:** login, data-mode banner (from the server), offline banner, location selector filtered to server memberships, overview, and settings (pilot setup gates, taxes and prices, staff access, manager PIN). It also includes the shared `useRpcMutation` hook with request keys and uncertain-outcome resolution.
- **Docs:** README, demo setup, pilot setup runbook, deployment notes and ADRs 0001–0008.

### Decisions made in this milestone (see `docs/decisions/`)

- 0001 Authorization runs before the idempotency lookup. Concurrent duplicates are serialized.
- 0002 Physical-constant conversions are allowed within a dimension. Cross-dimension conversions need an item-specific verified row.
- 0003 One pack per supplier item in the MVP.
- 0004 Demo switch and reset are database functions reachable only through allowlisted operator scripts.
- 0005 Demo opening stock is deferred to the Milestone 2 ledger.
- 0006 PIN failures are returned rather than raised, so lockout counters persist.
- 0007 Setup-gate preconditions. Gates for later workflows cannot be confirmed yet.
- 0008 Local stack runs from Docker Hub images, with Vitest 3 projects and serial integration files.

### Known limitations and open items

- The `opening_counts_posted`, `planning_inputs_confirmed` and `return_policy_configured` gates cannot be confirmed until Milestones 2–4.
- There is no UI yet for supplier payment terms or pack sizes (needed by the `supplier_master_verified` and `pack_conversions_verified` gates). It arrives with purchasing in Milestone 2.
- Customers are readable by the owner only. The order-context lookup for managers and employees ships with the POS.
- The bundle is about 511 kB (152 kB gzipped). Code-splitting is deferred until there are more screens.

## Milestone 2 — Complete restaurant transaction (2026-11-13)

**Exit criteria (CLAUDE.md §10):** AC04–AC10, AC17, AC20 (sales part) and AC29.

| Check | Status | Notes |
|---|---|---|
| AC04 Unit precision | PASS | Two 10,000 g packs add 20,000 g; kg converts exactly; ml for a gram item is rejected; FG-002 issues 3 tortillas and 0.5 lime |
| AC05 Shared ingredients | PASS | 940 g reserved, 1,060 g left, 940 g issued once |
| AC06 Concurrency | PASS | Two sessions, one portion: exactly one acceptance |
| AC07 Retries | PARTIAL | Accept, kitchen start, receipt and payment pass. Refund retry ships with refunds (Milestone 3) |
| AC08 Cancellation | PASS | Release before start; after start, PIN-approved waste with no restock |
| AC09 Snapshots | PARTIAL | Requirements and totals pass. Refund calculations are Milestone 3 |
| AC10 Partial receipts | PASS | 6 of 10, retries, duplicate slip, stale version, audited over-receipt |
| AC17 Recorded money | PARTIAL | POS tenders recorded/simulated; zero-balance pickup; no overpayment. Refund and AP records are Milestone 3 |
| AC20 Reconciliation | PARTIAL | Sales, tax, COGS and waste reconcile with direct SQL. Refunds are 0 until Milestone 3 |
| AC29 Failure recovery | PASS | Lost response and expired session on real order RPCs; offline; never-sent write |

**Why some exit checks are PARTIAL:** AC07, AC09, AC17 and AC20 include refund (and, for AC17, supplier AP) clauses. CLAUDE.md §10 schedules refunds and supplier invoices for Milestone 3. Every other clause of these checks passes with test evidence. The operator should accept or redirect this split.

### Test evidence (final full run)

| Suite | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `supabase db lint` | clean |
| `npm run test:unit` | 35 passed |
| `npm run test:db` | 85 passed (new: `004_ledger.test.sql`, 22) |
| `npm run test:integration` | pilot 47, **pilot operations 28 (new)**, demo 18 — all passed |
| `npm run build && npm run test:secrets -- --require-dist` | passed |
| `npm run test:e2e` | 12 passed (new: `transaction.spec.ts`, 5) |

### Delivered

- **Migrations 0009–0014:** inventory ledger, purchasing, orders, read models/reports, approver list, and the settings-update fix.
- **Screens:** Dashboard, POS, Kitchen & pickup, Inventory (stock, lots, opening count, menu availability), Purchasing (POs, receiving, suppliers & packs).
- **Demo:** the importer now posts the 126 synthetic opening rows through the ledger.
- **New integration suite:** `tests/integration/ops/`. It runs the real pilot setup path (terms, packs, taxes, prices, every gate, opening counts with use-by dates, enable posting) through the RPCs before testing transactions.

### Bugs found and fixed

- `enable_posting` / `reopen_setup_gate` (Milestone 1) failed through the API because Supabase's safe-update guard requires a `WHERE` clause. Fixed in migration 0014 (ADR 0014).
- `post_movement` used an upsert for negative deltas. Postgres checks constraints on the proposed insert row before resolving the conflict, so issues failed. It now updates first and inserts only for a new balance row.
- Two-path PostgREST embeds (order lines → items) were made explicit with FK hints.
- Numeric columns read directly from tables arrive as JSON numbers. The quantity formatter now accepts both forms, and an error boundary prevents blank screens.
- Integration setups now wait for the REST and Auth containers after each database reset.

### Decisions (ADRs 0009–0016)

- 0009 Manager self-approval; PIN only for non-managers; over-receipt acknowledgement flag.
- 0010 Receipts in packs or verified units; two-pass receipt posting.
- 0011 Order edits write a new revision.
- 0012 Orders with a recorded payment cannot be cancelled until refunds exist.
- 0013 Demo opening stock is posted through the ledger (supersedes 0005).
- 0014 The safe-update fix.
- 0015 Sales summary definitions and access.
- 0016 Kitchen refresh by polling.

### Known limitations and open items

- Cancelling a paid order waits for refunds (Milestone 3).
- There is no recipe-version editing UI yet.
- Counts, waste, transfers, quarantine moves, returns, invoices, planning, labels and staff time are Milestones 3–4.
- The dashboard does not yet show supplier balances or worked hours.
- The `planning_inputs_confirmed` and `return_policy_configured` gates stay unconfirmable until Milestones 3–4. Posting does not depend on them.

## Milestone 3 — Inventory and financial controls (2026-11-13)

**Exit criteria (CLAUDE.md §10):** AC11–AC16, AC18, AC19, AC20 (waste part) and AC31 (immutability part). All are met. The refund and AP clauses left open in Milestone 2 now pass too, so AC07, AC09, AC17 and AC20 are complete.

| Check | Status | Notes |
|---|---|---|
| AC11 Count conflict | PASS | A movement after the snapshot rejects the whole count; a fresh count posts one reason-coded adjustment; counts can't drop below reserved stock |
| AC12 Lot eligibility | PASS | An expired reserved lot is reassigned at kitchen start, or the start is blocked with nothing issued; quarantine leaves availability until release |
| AC13 Transfers | PASS | Source −1000, destination +600 then +350, 50 lost with a reason; received + lost + in transit = dispatched in quantity and cost |
| AC14 Returns and exchanges | PASS | Meal refunds post no movement; retail returns are limited by units sold and the window and go to custody; a short exchange posts nothing |
| AC15 Retail cost reversal | PASS | Demo restock at the original issue cost with exactly one COGS reversal; pilot returns gated and restock off until the owner enables it |
| AC16 Refund limits | PASS | Snapshot allocation with an exact final remainder; per-line and per-order caps; employees need a manager PIN |
| AC18 Invoices and payments | PASS | Normalized duplicate numbers refused; partial payment, no overpayment, reversal; overdue from the due date and the Denver business date |
| AC19 Invoice costs | PASS | Creating and revising invoices leaves movements, valuation and COGS unchanged; discrepancies need acceptance and stay traceable by revision |
| AC20 Reconciliation | PASS | Refunds by refund date; waste = post-start cancellations + posted waste reports + transit losses, each matching direct SQL |
| AC31 Immutability part | PASS (check stays PARTIAL) | New money and control rows are append-only, with linked reversals. The backup/restore drill is Milestone 5 |
| AC07, AC09, AC17 | PASS | Refund retry, refund snapshots, MANUAL_EXTERNAL/SIMULATED refund and AP records |

Checklist now: **21 PASS, 5 PARTIAL (AC03, AC28, AC30, AC31, AC32), 8 NOT_RUN (Milestones 4–5).**

### Test evidence (final full run)

| Suite | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `supabase db lint --level warning`, Prettier check | clean |
| `npm run test:unit` | 35 passed |
| `npm run test:db` | 112 passed (new: `005_controls.test.sql`, 27) |
| `npm run test:integration` | pilot 47, pilot operations 55 (27 new), demo 24 (6 new) — all passed |
| `npm run build && npm run test:secrets` | passed |
| `npm run test:e2e` | 18 passed (new: `controls.spec.ts`, 6) |

### Delivered

- **Migrations 0015–0019:** inventory controls (counts, waste reports, quarantine, transfers); refunds, returns, custody, exchanges, return policy and cancel-with-refund; supplier invoices, payments, credits and reversals; Milestone 3 reporting and demo reset; waste-cost visibility and list reads.
- **Screens:** Inventory tabs (stock with quarantine/release, counts, waste reports, transfers); Refunds & returns (refund, retail return, exchange, returned-goods decisions); Supplier invoices (entry with receipt matching, variances, acceptance, payments, credits, reversals, corrections, void); Settings → Return policy; dashboard metrics for refunds, COGS reversal, the waste breakdown, count variance, inventory and in-transit value, and supplier balances; kitchen cancel with refund.
- **Demo:** the seed adds a synthetic return policy (30 days, restock allowed).

### Bugs found and fixed during the milestone

- `post_stock_count` and `change_stock_condition` were missing the posting-enabled check. Added before the migration was committed.
- Employees could read the cost columns of their own waste reports through the API. Column grants now hide them (0019).
- The discrepancy-accepted flag returned `null` instead of `false` before any acceptance.
- Several forms lost their success message when the list refreshed after a save. Confirmations now stay visible.
- The Milestone 2 reconciliation test assumed refunds were 0. It now nets refunds and checks the cancellation part of the waste breakdown.

### Decisions (ADRs 0017–0023)

- 0017 Refund amounts from line snapshots with an exact final remainder; cancellation records the refund (supersedes 0012).
- 0018 Retail returns go to custody; restock is policy-gated, and the pilot starts with no policy.
- 0019 Exchanges are one transaction with an exchange-credit tender.
- 0020 Count snapshots use the movement number; the whole count is rejected if stock moved.
- 0021 Transfers: source cost, destination receipt; losses and in-transit value belong to the source.
- 0022 Supplier invoices: variance acceptance before payment, revisions, voids, due dates from verified terms.
- 0023 Waste reports: removal order and cost visibility.

### Known limitations and open items

- **Selling location only:** refunds and returns are processed at the location that made the sale. There is no cross-location return.
- **Exchange shortfall:** an exchange with a balance still due leaves the replacement order `ready`. Staff collect the rest and complete pickup on the kitchen screen.
- **Transfers:** a draft transfer reserves nothing until dispatch, so dispatch can still fail on a shortage (the error names the item).
- **Invoices:** matching covers receipts from the last 180 days. There is no supplier statement reconciliation or AP aging export beyond the dashboard totals.
- **Bundle size:** the bundle is now about 634 kB (about 180 kB gzipped). Code-splitting is still deferred.
- **Still open:** recipe-version editing UI, planning, labels and staff time (Milestone 4); the backup/restore drill, performance and deployment (Milestone 5).

## Milestone 4 — Planning and staff tools (2026-11-13)

**Exit criteria (CLAUDE.md §10):** AC21–AC28. All pass. AC03 (permission enforcement) also moves to PASS, since every authorization-matrix row now has negative tests.

| Check | Status | Notes |
|---|---|---|
| AC21 MRP reservations | PASS | Today's accepted, in-progress and fulfilled orders are subtracted before the BOM explosion; projection starts from available stock (reservations already excluded); POs count only on their expected date; late POs are flagged |
| AC22 EOQ units | PASS | SQL `private.eoq`: 447.214 → 450 with 25-unit packs; H ≤ 0 and negatives rejected; settings saved with unit labels after the planning gate; manager demand input when history is insufficient |
| AC23 Forecast provenance | PASS | Only dates before the as-of date; no history → manager forecast required; demo history is a labeled alternative refused in the pilot |
| AC24 Availability explanation | PASS | Independent dish potentials with the limiting ingredient match direct SQL; the menu mix sums shared chicken and garlic and writes nothing |
| AC25 Clock integrity | PASS | Two simultaneous clock-ins → one open entry; no employee or time parameter; direct writes refused; no overlap across locations |
| AC26 Schedules and corrections | PASS | Employees see only their own published shifts; overlaps fail; published changes need a reason; corrections keep originals and a reason |
| AC27 Timezone | PASS | Fall-back night 9 h = 2 h + 7 h; spring-forward 7 h = 2 h + 5 h; breaks per local day; sales use local business dates |
| AC28 Barcodes | PASS | 47 Code 128 labels with readable ID, name and base unit; print stylesheet; scanner test reads keyboard-wedge input back. A physical scanner check belongs to the Milestone 5 tablet pass |
| AC03 Permissions | PASS | Negative tests for every matrix row, including shifts, clocking, corrections, forecasts, settings and simulation |

Checklist now: **30 PASS, 3 PARTIAL (AC30, AC31, AC32), 1 NOT_RUN (AC33).** All four remaining checks belong to Milestone 5: live hosting, the backup/restore drill, the tablet/keyboard/scanner pass, and the 20-session performance measurement.

### Test evidence (final full run)

| Suite | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `supabase db lint --level warning`, Prettier check | clean |
| `npm run test:unit` | 39 passed (new: `time.test.ts`, 4) |
| `npm run test:db` | 138 passed (new: `006_staff_planning.test.sql`, 26) |
| `npm run test:integration` | pilot 47, pilot operations 71 (16 new), demo 26 (2 new) — all passed |
| `npm run build && npm run test:secrets` | passed |
| `npm run test:e2e` | 22 passed (new: `staff-planning.spec.ts`, 4) |

### Delivered

- **Migrations 0020–0022:** schedules, clocking, breaks, corrections and the hours report; forecast, overrides, MRP projection, EOQ, ROP/EOQ settings, What can we serve and the menu mix; demo reset for the new tables.
- **Screens:** Staff time (my time and shifts, schedule, time records and hours), Planning (forecast, ingredient projection with draft-PO proposals, ROP/EOQ settings with an EOQ preview), What can we serve (with the manager menu-mix simulator), and Labels (print sheet and scanner test).
- **Client helper:** America/Denver wall-clock entry for shift and correction forms, unit-tested across both DST transitions.

### Bugs found and fixed during the milestone

- Clock-out padded a too-fast clock-out by a full second, so an immediate re-clock-in collided with it. The pad is now 1 microsecond, and an overlap reports `conflict:overlapping_time_entry` instead of "already clocked in".
- The EOQ preview first went through the write hook, which adds a request key to a read-only function. It is now a direct read call.

### Decisions (ADRs 0024–0029)

- 0024 Forecast history range, method and same-day netting.
- 0025 MRP projection, shortages and proposals saved as draft POs (no separate proposals table).
- 0026 EOQ inputs and units; `planning_inputs_confirmed` becomes an owner attestation per location.
- 0027 Clocking, breaks, unscheduled flag and correction rules (managers cannot correct their own time).
- 0028 What can we serve visibility and the read-only menu mix.
- 0029 Barcode labels and the scanner test.

### Known limitations and open items

- **Forecasts:** orders are same-day only, so netting applies to the current business date. There are no future-dated pickups.
- **Planning scope:** the projection treats a day without a forecast as 0 demand and flags it; it does not invent demand. Shelf life is never inferred; only the manager's cover-day setting caps quantities.
- **Time records:** corrections can only set past times. There is no shift-swap workflow, and no notifications (no email/SMS by design).
- **Labels:** verified with simulated keyboard-wedge input. Physical scanner hardware is part of the Milestone 5 tablet pass.
- **Bundle size:** about 743 kB (205 kB gzipped). Code-splitting by route is a Milestone 5 candidate.
- **Milestone 5 still open:** full acceptance run, tablet/keyboard/scanner pass, 20-session performance (AC33), backup/restore drill (AC31), deployment docs and the pilot runbook, `ACCEPTANCE_REPORT.md`.

## Milestone 5 — Pilot readiness (2026-11-13)

**Exit criterion (CLAUDE.md §10):** every AC is PASS, or is listed with a reason the operator must accept. Result: **33 PASS, 1 PARTIAL**. The final report is [`ACCEPTANCE_REPORT.md`](ACCEPTANCE_REPORT.md).

| Check | Status | Notes |
|---|---|---|
| AC31 Audit and restore | PASS | Local drill: full dump restored into a disposable database; 72 tables and 15 totals identical; ledger reconciles; RLS, append-only and grant controls intact. Hosted rehearsal is an operator step |
| AC32 Screen completeness | PASS | axe finds no serious/critical WCAG 2.1 A/AA problems on 36 screen scans; 44 px targets; portrait layout; keyboard-and-scanner-only POS flow with visible focus |
| AC33 Performance and reporting | PASS | 20 sessions over 50,000 order lines: 100% of screen queries ≤ 2 s (p95 480 ms), acceptance p95 241 ms; CSV equals the screen and keeps role limits |
| AC30 Hosting and secrets | **PARTIAL** | Secrets pass and the base path works on a local static preview. A live GitHub Pages check needs hosted projects and operator direction. The **operator must accept this, or direct the deployment** |

### Test evidence (final full run)

| Suite | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, Prettier check, `supabase db lint --level warning` | clean |
| `npm run test:unit` | 39 passed |
| `npm run test:db` | 138 passed |
| `npm run test:integration` | pilot 49 (2 new: the perf script refuses pilot), pilot operations 71, demo 28 (2 new: restore drill) — all passed |
| `npm run build && npm run test:secrets -- --require-dist` | passed |
| `npm run test:e2e` | 29 passed (new: `tablet.spec.ts`, 4; `reports.spec.ts`, 3) |
| `npm run perf:load` | targets met (`evidence/perf-AC33.md`) |
| `npm run ops:drill` | PASS (`evidence/backup-restore-drill.md`) |

### Delivered

- **Tools:** `scripts/perf/load-test.ts` (20-session load and latency report with a labeled volume fixture; refuses pilot databases) and `scripts/ops/backup-restore-drill.ts` (local drill and a hosted `compare` mode).
- **Evidence:** `docs/acceptance/evidence/perf-AC33.{md,json}` and `backup-restore-drill.{md,json}`, containing counts, timings and hashes only (no data rows).
- **Tablet pass:** an axe accessibility scan of every screen for both roles, touch-target checks, portrait layout and a keyboard-only POS flow.
- **Fixes from the pass:** wide tables are now keyboard-focusable labeled regions. Route-level code splitting takes the main bundle from 743 kB to 463 kB.
- **Ops documents:** `backup-restore.md` (local drill and hosted procedure), `manual-outage-fallback.md`, `deployment.md` (projects, Pages workflow, CI, updates and rollback), and the go-live checklist in `pilot-setup.md`.
- **Workflows:** `.github/workflows/pages.yml` (manual-only deploy with a secret scan) and `ci.yml` (pull requests: static checks, then the full local-stack suites). Neither has run yet.
- **Report:** `ACCEPTANCE_REPORT.md`.

### Bugs found and fixed

- The dashboard's horizontally scrolling table was not reachable by keyboard (axe `scrollable-region-focusable`). All wide tables are now focusable labeled regions.
- The secret scanner caught an example connection string with an inline password in the new backup doc. It now uses a placeholder. The guard worked as designed.
- The drill script's integrity result type failed `typecheck` in one commit; the next commit fixed it.

### Decisions (ADRs 0030–0032)

- 0030 How performance was measured: volume fixture, role scenarios, local stack.
- 0031 The restore drill on a disposable local database, and what "intact" means.
- 0032 The automated tablet pass and route-level code splitting.

### Open items for the operator

See "What the operator must do or accept" in `ACCEPTANCE_REPORT.md`: live hosting (AC30), the hosted restore rehearsal, the hosted performance rerun, on-site device checks, real operating values for every gate, and the ADR decisions to confirm.
