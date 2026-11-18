# 0034 Item stock chart and manager reorder alerts

Operator decision (session, 2026-11-18).

- **Chart:** a Chart button beside each on-hand count in Inventory → Stock & lots (managers and owner). It opens a combined chart:
  - on hand at the end of each business date, with the reorder point as a dashed line;
  - daily bars for usage (kitchen issues and retail sales), waste and deliveries (receipts and incoming transfers);
  - a 7/30/90-day toggle (default 30), the Planning screen's suggested order quantity (EOQ rounded to packs) and the next open purchase order.
- Counts, reversals, condition changes and outgoing transfers move the stock line but are not counted as usage. The line is rebuilt from `inventory_movements` (`private.item_stock_series`), so it equals the live balance on the last day.
- **Drawing:** hand-written SVG with no new dependency, plus a "Show as table" view for screen readers and keyboard users.
- **Demo limitation:** the synthetic sales history (`historical_sales_*`) has no stock movements, so demo charts start at the opening count.
- **Alerts:** a "Needs reordering" card on Overview for the location's manager. It uses the existing badge rule (available < reorder point), is checked on open and every 60 seconds, and stores nothing. An item drops off once stock is back at or above the reorder point.
- The owner is not notified (operator instruction). `get_reorder_alerts` uses explicit manager memberships only, and the owner gets an empty list. The owner still sees the badges, charts and the dashboard's low-stock count.
- Polling rather than Realtime keeps CLAUDE.md §2 (Realtime is for the kitchen only).
