# AC33 performance measurement (generated)

Measured 2026-11-13T21:20:23.186Z by `scripts/perf/load-test.ts`. Environment: local Supabase stack (Docker) on the build machine; API over HTTP to localhost; not a hosted project.

- Sessions: **20** concurrent (10 demo role users × 2), 12 scenario iterations each, 15.3 s wall time.
- Data volume: 50,000 operational order lines (25,000 orders) plus 16,501 demo history lines; 126 stock movements.
- Screen queries: 960 calls, **100% within 2 s** (target 95%), p95 480 ms.
- Order acceptance: 144 calls, **p95 241 ms**, max 404 ms (target 3,000 ms).
- Unexpected errors: 0. Business refusals (for example `insufficient_stock` when a dish runs out) are expected outcomes and are counted separately.
- Result: **targets met** in this environment.

## Invariants after the run

| Check | Count (must be 0) |
|---|---|
| bad_balances | 0 |
| balances_not_matching_ledger | 0 |
| completed_with_balance_due | 0 |
| duplicate_pickup_codes | 0 |
| leaked_reservations | 0 |

## Per operation

| Operation | Kind | Calls | OK | Business refusals | Errors | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|---|---|---|
| accept_order | accept | 144 | 144 | 0 | 0 | 93 | 241 | 404 |
| complete_order_pickup | write | 144 | 144 | 0 | 0 | 64 | 239 | 429 |
| get_demand_forecast | query | 72 | 72 | 0 | 0 | 256 | 592 | 681 |
| get_demand_forecast_historical | query | 24 | 24 | 0 | 0 | 312 | 540 | 588 |
| get_hours_report | query | 72 | 72 | 0 | 0 | 10 | 130 | 274 |
| get_pos_menu | query | 144 | 144 | 0 | 0 | 80 | 230 | 460 |
| get_replenishment_plan | query | 72 | 72 | 0 | 0 | 412 | 951 | 1185 |
| get_sales_summary_30d | query | 72 | 72 | 0 | 0 | 71 | 221 | 384 |
| get_sales_summary_all_30d | query | 24 | 24 | 0 | 0 | 147 | 236 | 545 |
| get_sales_summary_day | query | 48 | 48 | 0 | 0 | 93 | 224 | 388 |
| get_sales_summary_historical_184d | query | 24 | 24 | 0 | 0 | 339 | 505 | 551 |
| get_serve_view | query | 120 | 120 | 0 | 0 | 221 | 462 | 684 |
| get_stock_overview | query | 72 | 72 | 0 | 0 | 32 | 204 | 298 |
| get_supplier_invoices | query | 72 | 72 | 0 | 0 | 12 | 92 | 146 |
| kitchen_queue | query | 144 | 144 | 0 | 0 | 62 | 213 | 375 |
| mark_order_ready | write | 144 | 144 | 0 | 0 | 58 | 205 | 410 |
| record_tender | write | 144 | 144 | 0 | 0 | 60 | 241 | 520 |
| start_order_preparation | write | 103 | 103 | 0 | 0 | 89 | 260 | 479 |

These are measurements on a local machine, not claims about a hosted Supabase project. Repeat the run against the hosted demo project before go-live (operator action).
