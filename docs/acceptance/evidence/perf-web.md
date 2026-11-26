# Website load measurement (generated)

Measured 2026-11-26T04:39:39.920Z by `scripts/perf/web-load-test.ts`. Environment: local Supabase stack (Docker); API over HTTP to localhost; not a hosted project.

- Visitors: **20** concurrent, anon key, no sign-in; 6 customer journeys each (locations, menu, pickup slots, place order), 1.4 s wall time.
- Reads: 360 calls, **100.0% within 2 s** (target 95%), p95 126 ms.
- Order placements: 120 calls (116 placed), **p95 165 ms** (target 3,000 ms).
- Business refusals (expected, e.g. a slot filling up or a dish running out): 4 (slot_unavailable × 4).
- Unexpected errors: 0.
- Result: **targets met** in this environment.

## Invariants after the run

| Check | Count (must be 0) |
|---|---|
| slots_over_capacity | 0 |
| web_orders_without_contact | 0 |
| demo_web_orders_not_fully_paid | 0 |
| reservations_above_on_hand | 0 |
| duplicate_pickup_codes | 0 |

## Per operation

| Operation | Calls | OK | Business refusals | Errors | p50 ms | p95 ms | max ms |
|---|---|---|---|---|---|---|---|
| web_get_locations | 120 | 120 | 0 | 0 | 36 | 134 | 156 |
| web_get_menu | 120 | 120 | 0 | 0 | 45 | 100 | 149 |
| web_get_pickup_slots | 120 | 120 | 0 | 0 | 35 | 75 | 185 |
| web_place_order | 120 | 116 | 4 | 0 | 74 | 165 | 228 |
