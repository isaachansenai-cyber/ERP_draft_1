# 0023 Waste reports: removal order and cost visibility

- A waste report moves no stock. When a manager posts it, unreserved stock is removed in this order: quarantined first, then expired, then earliest use-by, at the current weighted-average cost. Reserved stock is never wasted from under an accepted order.
- Employees can read the reports they submitted, but the cost columns are not granted to API roles. `list_waste_reports` returns costs only to managers and the owner (PRD §4).
- Quarantine of owned stock (`change_stock_condition`) keeps it on hand and valued but never available; release back to sellable is refused for an expired lot.
