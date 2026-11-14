# 0025 MRP projection, shortages and proposals

- The projection starts today from available stock (eligible sellable on hand − reservations; quarantine and expired stock excluded) and runs 1–28 days, 14 by default.
- Requirements = residual forecast × active recipe quantity, summed across dishes. A day with no forecast (manager required) counts as 0 and is flagged `forecast_missing`; the UI says so instead of hiding it.
- Open PO balances arrive only on their expected date. Late or undated POs are listed as `late_receipts` and are not added to any day.
- A shortage is the first day the projected balance drops below safety stock (0 when none is set). The proposed order date is that day minus the supplier-item lead time (or the item's), and is flagged `late` when it is already past.
- The proposed quantity restores the lowest projected balance to safety stock, rounded up to whole packs. The suggested ROP is the average daily requirement × lead days + safety stock; it is shown, never saved automatically.
- Proposals are previews. **Saving one creates a draft purchase order through the normal `create_purchase_order` RPC** (audited, gated, nothing sent to the supplier). There is no separate `replenishment_proposals` table: the draft PO is the saved proposal.
