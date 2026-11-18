# 0033 Employees see only what their job needs

Operator decision (session, 2026-11-18). It narrows CLAUDE.md §6 and PRD §4 for employees.

- Employees keep: Overview, POS, Kitchen, waste reports, Refunds & returns (with a manager PIN), What can we serve, and their own Staff time.
- Employees lose: the Dashboard, including the own-location daily sales summary that §6 previously granted, plus Labels, all of Settings, and the Inventory stock list.
- Server side: `get_sales_summary` (and therefore its CSV export) and `get_stock_overview` refuse employees with `unauthorized`. `lots`, `stock_balances` and `reservation_allocations` are readable by managers and the owner only. The waste form gets item names from `list_stock_items`, which returns no quantities.
- Labels and the Settings reads (tax rates, return policy, setup gates) are hidden in the app only. Their data (item names, rates, policy) is also needed by POS and Returns, and none of it is sensitive.
- Individual order rows stay readable at the employee's location, because Kitchen, POS and Returns need them. An employee with direct API access could still add up their location's orders. Only the aggregated report is withheld.
- What can we serve still shows employees the limiting ingredient's available quantity for each dish.
- Navigation shows Inventory as "Waste reports" for employees. A typed address for a removed screen shows "Not permitted".
