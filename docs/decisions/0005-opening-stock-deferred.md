# 0005 Demo opening stock is posted in Milestone 2

> **Superseded by ADR 0013** (Milestone 2): demo opening stock is now posted through the ledger by the demo seed importer.

**Context.** `demo_seed.json` contains 126 synthetic opening-stock rows.
**Decision.** The Milestone 1 demo importer validates the row count but does not store or post these rows. Opening stock must enter through the append-only stock ledger and the opening-count workflow (PRD §6), which arrive in Milestone 2. A temporary staging table would create stock outside the ledger.
**Effect.** In Milestone 1 the demo has no stock balances. The `opening_counts_posted` gate cannot be confirmed in the pilot until that workflow exists.
