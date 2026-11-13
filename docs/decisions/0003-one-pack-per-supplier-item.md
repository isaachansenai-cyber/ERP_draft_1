# 0003 One purchase pack per supplier item (MVP)

**Context.** CLAUDE.md §5.2 lists `purchase_packs` separately from `supplier_items`.
**Decision.** In the MVP, each supplier–item relation carries one pack definition (`pack_description`, `pack_base_qty`, `pack_cost_cents`, `unit_cost`, `cost_basis`) on `supplier_items`. Receipts will snapshot the pack conversion they use (Milestone 2), so a later pack change never rewrites history.
**Revisit** if a supplier sells the same item in several pack sizes. That would mean a separate `purchase_packs` table referenced by receipt lines.
