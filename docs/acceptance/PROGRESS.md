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
