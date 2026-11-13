# 0028 What can we serve and the menu-mix preview

- Portions per dish = floor(min over components of available ÷ quantity per serving), using live availability. The response states that the potentials are independent and cannot be added together.
- Employees see portions, the limiting ingredient and today's order counts (they already see availability at the POS). Planned demand and forecast method are shown to managers only, because forecasting is a manager function.
- The next delivery is the earliest open PO line for the limiting ingredient at the location (or "date not set").
- The menu-mix simulator is manager-only and read-only. It sums shared components across the whole mix, marks them `shared`, and previews pack-rounded replenishment with the earliest possible arrival (today + lead days). It writes nothing; saving an order happens in Planning or Purchasing.
