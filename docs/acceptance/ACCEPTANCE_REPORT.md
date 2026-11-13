# Acceptance report — Meats Around the World ERP (MVP pilot)

Final report for Milestone 5 (CLAUDE.md §10, PRD §17–§18), as of **2026-11-13**, branch `milestone-5/pilot-readiness`.

**Result: 33 of 34 checks PASS. 1 is PARTIAL (AC30): the live GitHub Pages check needs an operator to create the hosted projects and publish.** Every PASS has test evidence; the full evidence for each check is in [`Acceptance_Checklist.csv`](Acceptance_Checklist.csv). Grading-rubric coverage is **not claimed**: the rubric text was never supplied (CLAUDE.md §13).

## Final acceptance run

Run on the build machine against the disposable local Supabase stack. Each suite resets its own database.

| Suite | Command | Result |
|---|---|---|
| Static checks | `npm run typecheck`, `npm run lint`, Prettier check, `supabase db lint --level warning` | clean |
| Unit | `npm run test:unit` | 39 passed |
| Database (pgTAP) | `npm run test:db` | 138 passed (6 files) |
| Integration: pilot | `npm run test:integration` (pilot project) | 49 passed |
| Integration: pilot operations | (ops project: full pilot setup through the real RPCs, then transactions) | 71 passed |
| Integration: demo | (demo project, including the backup/restore drill) | 28 passed |
| End-to-end | `npm run test:e2e -- --trace off` (production build under `/ERP_draft_1/`, tablet viewport) | 29 passed |
| Secrets | `npm run build && npm run test:secrets -- --require-dist` | passed |
| Performance (AC33) | `npm run perf:load` (20 sessions) | targets met ([evidence](evidence/perf-AC33.md)) |
| Backup/restore (AC31) | `npm run ops:drill` | identical copy, controls intact ([evidence](evidence/backup-restore-drill.md)) |

Total automated assertions: 354 test cases (39 + 138 + 49 + 71 + 28 + 29), plus the two measured runs.

## Status by check

| Check | Area | Status | Evidence (summary) |
|---|---|---|---|
| AC01 | Source import | **PASS** | tests/integration/pilot/ac01-source-import.test.ts (9 tests: 40 ingredients/5 dishes/IDs, 66 BOM lines 12/16/14/17/7 exact quantities, FG-002 3 tortillas + 0.5 lime, 15 suppliers + 5 missing phones kept NULL, 40 primary links + 21/19 lead-time basis, mL->ml ve… |
| AC02 | Demo segregation | **PASS** | Pilot: tests/integration/pilot/ac02-pilot-segregation.test.ts (no synthetic staff/customers/history/opening/prices/taxes/costs; all 4 demo scripts refuse pilot and non-allowlisted targets; DB refuses pilot->demo switch; refused runs change nothing). DB guards:… |
| AC03 | Permission enforcement | **PASS** | Real local Auth users, at least one negative test per authorization-matrix row: tests/integration/pilot/ac03-permissions.test.ts (memberships cannot be changed by managers or employees; staff, gates, taxes, prices; cost, supplier, customer and audit visibility… |
| AC04 | Unit precision | **PASS** | Receiving: tests/integration/ops/ac04-ac10-purchasing.test.ts "receiving two 10,000 g packs adds 20,000 g", "kg converts exactly", "unverified cross-dimension conversion is rejected". Consumption: tests/integration/ops/ac05-ac06-reservations.test.ts "one FG-00… |
| AC05 | Shared-ingredient aggregation | **PASS** | tests/integration/ops/ac05-ac06-reservations.test.ts "with 2,000 g chicken, 3 x FG-001 + 2 x FG-003 reserves 940 g, leaves 1,060 g and issues 940 g once" (also: same-key kitchen-start retry issues nothing; ready/pickup issue nothing) and "a short ingredient re… |
| AC06 | Concurrency | **PASS** | tests/integration/ops/ac05-ac06-reservations.test.ts "exactly one acceptance succeeds; the other gets insufficient_stock; nothing partial remains" (two signed-in sessions fired concurrently against 180 g = one portion; balances verified; no negative or over-re… |
| AC07 | Request retries | **PASS** | All five retried actions return the original result with no duplicate documents, money records or movements: accept and payment in tests/integration/ops/ac07-ac09-ac17-ac20-orders.test.ts; kitchen start in tests/integration/ops/ac05-ac06-reservations.test.ts; … |
| AC08 | Order cancellation | **PASS** | tests/integration/ops/ac07-ac09-ac17-ac20-orders.test.ts "before kitchen start any staff member can cancel and the reservation is released" and "after kitchen start a manager approval is required; waste records the issued cost; nothing is restocked or issued t… |
| AC09 | Historical snapshots | **PASS** | Requirements and totals: tests/integration/ops/ac07-ac09-ac17-ac20-orders.test.ts "recipe, price and tax changes after acceptance do not change the order". Refund calculations: tests/integration/ops/m3-refunds-ap.test.ts "refunds use the line snapshots even af… |
| AC10 | Partial receipts | **PASS** | tests/integration/ops/ac04-ac10-purchasing.test.ts "receiving 6 of 10 packs adds six packs and leaves four open; a retry adds nothing" (+ duplicate packing slip with a new key rejected, stale version rejected), "an over-receipt needs an explicit, audited manag… |
| AC11 | Count conflict | **PASS** | tests/integration/ops/m3-inventory-controls.test.ts "a count is rejected if stock moved after its snapshot; a fresh count posts with a reason" (stale count -> conflict:stock_changed_since_count; fresh count posts one COUNT_VARIANCE movement of -50) and "a coun… |
| AC12 | Lot eligibility | **PASS** | Ledger: supabase/tests/004_ledger.test.sql (FEFO order, availability excludes expired and quarantined, quarantined cannot be reserved). Pilot use-by on receipts: tests/integration/ops/ac04-ac10-purchasing.test.ts. Expiry before fulfillment: tests/integration/o… |
| AC13 | Transfer reconciliation | **PASS** | tests/integration/ops/m3-inventory-controls.test.ts "dispatch -> partial receive -> final receive with a reason-coded loss" (source -1000, destination +600 then +350, 50 lost with TRANSIT_LOSS, in transit 400 then 0, received cost + lost cost = dispatched cost… |
| AC14 | Returns and exchanges | **PASS** | Meal refunds never restock: tests/integration/ops/m3-refunds-ap.test.ts "a meal refund restocks nothing..." (no movement, ingredient balance unchanged) and "pilot retail returns stay closed..." (meals -> validation:meals_are_refunded_not_returned). Retail retu… |
| AC15 | Retail cost reversal | **PASS** | Demo restock: tests/integration/demo/m3-demo-returns.test.ts "restock of an unopened unit; an opened unit can only be disposed" (return_restock movement at the original unit issue cost, exactly one cogs_reversals row equal to that cost, retry replays, second r… |
| AC16 | Refund limits | **PASS** | tests/integration/ops/m3-refunds-ap.test.ts "employees cannot refund without a manager PIN; a wrong PIN is rejected" (also other-location manager -> unauthorized), "per-unit refunds follow the original discount and tax allocation; the last unit takes the exact… |
| AC17 | Recorded money only | **PASS** | No card/bank API exists in the codebase. POS tenders: tests/integration/ops/ac07-ac09-ac17-ac20-orders.test.ts (pilot MANUAL_EXTERNAL, zero balance for pickup, no overpayment, approved complimentary order) and tests/integration/demo/m2-demo-operations.test.ts … |
| AC18 | Invoices and payments | **PASS** | tests/integration/ops/m3-refunds-ap.test.ts "a normalized duplicate invoice number is rejected even with a new request key" ("  inv-7001 " vs "INV-7001"), "partial payment reduces only that invoice; overpayment fails; retries pay once; reversal restores" and "… |
| AC19 | Receipt and invoice costs | **PASS** | tests/integration/ops/m3-refunds-ap.test.ts "a price discrepancy blocks payment until a manager accepts it; revisions keep the old lines" (movement count, item valuation and COGS identical before and after create and revise; payment blocked; employee acceptanc… |
| AC20 | Money reconciliation | **PASS** | Sales: tests/integration/ops/ac07-ac09-ac17-ac20-orders.test.ts (summary vs direct SQL, refunds netted, no order in both COGS and waste). Refunds and waste: tests/integration/ops/m3-refunds-ap.test.ts "gross - discounts - refunds = net; tax separate; waste cou… |
| AC21 | MRP reservations | **PASS** | tests/integration/ops/m4-planning.test.ts "accepted orders reduce the residual forecast before the BOM explosion; receipts count only on their expected date" (manager forecast 10 x FG-004 today; accepted, in-progress and fulfilled orders subtracted before expl… |
| AC22 | EOQ units | **PASS** | SQL function private.eoq: supabase/tests/006_staff_planning.test.sql (D=10,000, S=$20, H=$2 -> 447.214; 25-unit packs -> 450; D=0 -> 0; H<=0, negative D and negative S rejected). API: tests/integration/ops/m4-planning.test.ts "D=10,000, S=$20, H=$2 gives 447.2… |
| AC23 | Forecast provenance | **PASS** | tests/integration/ops/m4-planning.test.ts "uses only dates before the as-of date; with no prior history the pilot requires a manager forecast" (as of today every item is manager_required because no completed date precedes it; as of tomorrow today's sales are o… |
| AC24 | Availability explanation | **PASS** | tests/integration/ops/m4-planning.test.ts "shows each dish's independent potential and its limiting ingredient" (portions = floor(min available / quantity per serving) and the bottleneck match direct SQL for all 5 dishes; note states potentials are not additiv… |
| AC25 | Clock integrity | **PASS** | tests/integration/ops/m4-staff-time.test.ts "two simultaneous clock-ins by the same employee create exactly one open entry" (two sessions, Promise.all: one success, one conflict:open_time_entry), "employees clock only themselves, only where assigned, and canno… |
| AC26 | Schedules and corrections | **PASS** | tests/integration/ops/m4-staff-time.test.ts "employees see only their own published shifts; drafts and others stay hidden", "overlapping shifts fail; published changes need a reason and are audited" (audit create -> publish -> update -> cancel; cancelled shift… |
| AC27 | Timezone | **PASS** | tests/integration/ops/m4-staff-time.test.ts "an overnight entry across the 2026-11-01 fall-back gives 9 elapsed hours split 2 + 7 at local midnight" (with a 30-minute break: 2.00 h on Oct 31, 6.50 h on Nov 1) and "sales filters use local business dates". pgTAP… |
| AC28 | Barcodes | **PASS** | Labels: tests/e2e/staff-planning.spec.ts "all 47 items print as Code 128 labels; the scanner test reads the readable ID back" (47 labels, each with a Code 128 SVG of its item ID plus readable ID, name and base unit; category filter; the print stylesheet hides … |
| AC29 | Failure recovery | **PASS** | tests/e2e/transaction.spec.ts "a POS acceptance whose response is lost is confirmed by its request key - one order, no duplicate" and "an expired session during a payment shows not confirmed, then confirms instead of resubmitting"; tests/e2e/foundation.spec.ts… |
| AC30 | Hosting and secrets | **PARTIAL** | Secrets PASS: npm run build && npm run test:secrets -- --require-dist (scripts/security/scan-secrets.mjs, unit-tested in tests/unit/scan-secrets.test.ts; it caught and blocked an example connection string with an inline password during Milestone 5). Only the a… |
| AC31 | Audit and restore | **PASS** | Immutability: append-only triggers and no API write grants for every ledger, money and control table (supabase/tests/002_invariants, 004_ledger, 005_controls, 006_staff_planning). Restore: scripts/ops/backup-restore-drill.ts restores a full pg_dump into a disp… |
| AC32 | Screen completeness | **PASS** | Every PRD screen exists with loading, empty, validation, unauthorized, conflict, offline and success states (shared mutation hook and error boundary; tests/e2e/foundation.spec.ts covers offline, lost responses and expired sessions). Tablet pass: tests/e2e/tabl… |
| AC33 | Performance and reporting | **PASS** | Performance: scripts/perf/load-test.ts with 20 concurrent signed-in sessions (10 demo role users x 2) over 50,000 operational order lines plus 16,501 history lines. 100% of 960 screen queries within 2 s (p95 480 ms; slowest the 14-day ingredient projection, p9… |
| AC34 | Historical import integrity | **PASS** | tests/integration/demo/ac34-history-integrity.test.ts (6 tests: 12,775 orders/16,501 lines, 184 days x 3 locations = 552, 0 order/line total mismatches across 5 aggregates, known customers/products, net sales 30,682,004 cents, SIMULATED tenders only, reimport … |

## What the operator must do or accept

1. **AC30 (live hosting):** create the demo and pilot Supabase projects, configure the GitHub environments and run the manual Pages workflow ([`../ops/deployment.md`](../ops/deployment.md)). Then repeat the deep-link reload check on the live URL. Until then AC30 stays PARTIAL; its secrets half passes.
2. **Hosted restore rehearsal:** back up the pilot, restore into a disposable project, and verify with `DRILL_MODE=compare` ([`../ops/backup-restore.md`](../ops/backup-restore.md)). This is the evidence for the `backup_restore_tested` gate. The local drill passed (AC31 PASS per CLAUDE.md §10).
3. **Hosted performance rerun:** run `npm run perf:load` against the hosted demo to include real network latency. The local measurement met every target.
4. **On-site device check:** test each location's tablet, scanner and label printer (go-live step 12 in [`../ops/pilot-setup.md`](../ops/pilot-setup.md)). The automated pass covered keyboard-wedge input, focus, touch targets and accessibility.
5. **Real operating values:** enter and confirm every pilot setup gate (supplier contacts and terms, packs and costs, recipes, prices, tax, perishables, return policy, opening counts, planning cost basis, roles) from real sources. Never copy demo values (D2).
6. **Decisions to confirm** (ADRs in [`../decisions/`](../decisions/)): the planning gate as an owner attestation (0026); proposals saved as draft POs (0025); managers cannot correct their own time (0027); restock disabled in the pilot by default (0018); transit losses attributed to the source location (0021); the performance volume fixture and local measurement (0030); the drill on a disposable local database (0031).

## Known limitations

- **Simplified production model:** standard ingredient consumption is recorded at kitchen start. There are no batches, yields, marination or prep stock (PRD §2). Physical counts and reason-coded waste find the differences.
- **Same-day orders only:** forecast netting applies to the current business date.
- **Returns and refunds** are processed at the selling location only. An exchange with a balance due waits on the kitchen screen.
- **Transfers:** a draft transfer reserves nothing, so dispatch can still fail on a shortage (the error names the item).
- **Supplier invoices:** receipt matching covers 180 days. There is no statement reconciliation or aging export beyond the dashboard totals.
- **Staff time:** not payroll; no shift swaps or notifications. Corrections can only set past times.
- **No recipe-version editor:** recipes are the source version 1.
- **Kitchen screen** refreshes by polling every 10 s, not Realtime (ADR 0016).
- **Outages:** there is no offline mode by design. The paper fallback is documented ([`../ops/manual-outage-fallback.md`](../ops/manual-outage-fallback.md)), and sales entered after an outage post on the entry date.
- **CI workflows** (`.github/workflows/ci.yml`, `pages.yml`) are prepared but have not yet run on GitHub.

## Out of scope (PRD §19)

Payroll, wages and taxes; general ledger and accounts receivable; payment, bank and card integrations; customer self-ordering or logins; table management; loyalty and marketing; maintenance; batch or prepared-food stock; substitutions, modifiers and nested recipes; autonomous supplier ordering or e-mail; camera scanning; offline sync; multi-currency; tips and split tenders; cash-drawer reconciliation; delivery marketplaces; partial fulfillment and item-level post-start cancellation.
