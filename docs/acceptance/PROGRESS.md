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
