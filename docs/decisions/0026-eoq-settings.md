# 0026 EOQ inputs, units and the planning gate

- `private.eoq(D, S, H)` is the system of record for the formula: D in base units/year, S in USD per order, H in USD per base unit per year. Negative D or S, or H ≤ 0, raise stable errors; D = 0 returns 0. The TypeScript screens only display server results.
- Settings store S as integer cents and H as `numeric(18,8)` USD, each with a unit label column. A manager annual-demand input column (`annual_demand_override_base`) covers the "insufficient history" case.
- Estimated D = fulfilled component use (from completed orders' requirement snapshots, plus retail units sold) in the last 180 complete days ÷ observed open days × 365. Under 28 observed days it is `insufficient` and EOQ needs the manager input.
- The actionable quantity is the EOQ rounded up to whole packs (and any minimum). The cover-days cap is shown with a warning and is never applied silently: the manager chooses.
- `planning_inputs_confirmed` (per location) is now an owner attestation that the cost basis and cover-day policy were reviewed. Until it is confirmed, managers can preview but cannot save approved settings. Every save is audited with before and after values.
