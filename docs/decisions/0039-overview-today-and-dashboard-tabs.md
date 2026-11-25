# 0039 Overview "Today" card and Dashboard tabs

Operator decision (session, 2026-11-25).

- **Overview:** managers and the owner get a "Today's sales" card: completed orders, net sales, recorded payments, average order value, cancelled orders and average fulfillment time for the current business date. Managers see their selected location; the owner sees every location plus an "All locations" row. That row only adds up whole cents and counts the server returned; averages are not recombined. The card uses `get_sales_summary`, the same function as the Dashboard, so the numbers always match. Employees see no card (ADR 0033).
- **Dashboard:** split into `#/dashboard/sales` and `#/dashboard/accounting`, with shared filters. Sales holds orders, gross sales, discounts, refunds, net sales, tax, recorded payments and refunds, average order value, fulfillment time and cancellations. Accounting holds net sales (as context), COGS, gross margin, retail COGS reversed, waste and its parts, count variance, inventory and in-transit value, pending prep cost, low-stock items and supplier balances.
- Other locations' summary-only rows (AC03) appear on the Sales tab only. CSV export covers the active tab and adds a `report` column.
