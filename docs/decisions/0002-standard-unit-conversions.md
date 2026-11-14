# 0002 Physical-constant conversions within a dimension

**Context.** PRD §5 allows "verified mass conversions within mass and volume conversions within volume" and forbids inferring g↔ml or each↔g.
**Decision.** `public.units` holds exact physical constants (kg, lb, oz; l, gal, fl_oz), and these are treated as verified for conversions *within* the same dimension. Anything that crosses dimensions requires an item-specific row in `item_unit_conversions`, with `verified_by`, a timestamp and an evidence note. Otherwise `private.convert_to_base` raises `validation:unverified_conversion`.
**Status.** Covered by pgTAP (`002_invariants`). Purchase packs always state an explicit base-unit quantity per pack (PRD §5).
