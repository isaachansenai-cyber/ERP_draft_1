# 0038 Supplier edits and change requests

Operator decision (session, 2026-11-25).

- **Owner edits directly:** an Edit button on each supplier (Purchasing → Suppliers & packs) for phone, email, address and the lead days of each ingredient that supplier provides. Lead time is stored per supplier and item, and Planning already prefers it over the item's own estimate.
- **Managers request:** suppliers have no logins (PRD §19), so a manager enters what a supplier told them as a change request with a required note. Nothing changes until the owner approves. The owner sees pending requests on Overview at login and on the Suppliers tab, compares current and proposed values, and approves (applies) or rejects with a reason. A request is flagged when the supplier was edited after it was made. Managers see only their own requests.
- **Labels:** saved values show "Owner-entered" with the date. The supplier stays "not independently verified" and its `supplier_master_verified` gate is confirmed separately: an edit never confirms or reopens a gate (CLAUDE.md §7).
- **Blank stays blank:** an empty field clears the value to NULL. Nothing is filled in automatically, and synthetic contacts are refused in a pilot database.
- Every write is idempotent, version-checked (`suppliers.version`, request `version`) and audited. Decided requests cannot change, and demo reset clears them.
