# 0018 Retail returns go to custody; restock is policy-gated

- Only retail lines can be returned; meals are refunded, never returned (PRD §8). A return must reference the original order at the same location, within the owner-set window, and cannot exceed the units sold minus units already returned.
- Returned units become a `return_custody` record (`held`) outside valued on-hand and availability. A manager then restocks or disposes of each record; disposal needs a note.
- Restock is allowed only when the return policy allows it, the unit is `unopened_intact`, and the item is retail and does not require a use-by date. It creates a new `return` lot, a `return_restock` movement at the original issue cost, and one `cogs_reversals` row (primary key = custody record, so at most once).
- The pilot starts with no policy: the `return_policy_configured` gate cannot be confirmed until the owner saves one, and restocking stays off unless the owner explicitly enables it. The demo seed inserts a synthetic policy (30 days, restock allowed), labeled `synthetic_demo_policy`.
- Refund on return is optional (for example, when goods come back but money was already settled another way).
