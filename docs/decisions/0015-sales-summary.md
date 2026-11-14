# 0015 Sales summary definitions and access (PRD §12)

`get_sales_summary(p_from, p_to, p_location_ids, p_source)` serves both the dashboard and its CSV export, so the two can never disagree.

- **Operational:** completed orders by *completion* business date (America/Denver).
  - Gross sales = Σ quantity × snapshotted unit price.
  - Net sales = gross − discounts − refunds. Refunds are 0 until Milestone 3. Tax is reported separately.
  - Recorded payments are summed by their own business date.
  - COGS = Σ issue-cost snapshots of completed orders.
  - Waste = issued cost of orders cancelled after kitchen start. It is never also counted in COGS.
  - Pending prep cost = issued cost of orders still preparing or ready.
  - Low stock = items whose available quantity is below the reorder point.
- **Historical (demo only):** read-only synthetic snapshots, labeled "demo historical (synthetic; cost fields are synthetic estimates)". The two sources are never combined.
- **Access:**
  - **Owner:** full metrics everywhere.
  - **Manager:** full metrics at their own locations; only order count and net sales elsewhere.
  - **Employee:** one day at their own locations, with no COGS, margin, waste or stock metrics.
- Null metrics (no permission, or a zero denominator) render as "—".
