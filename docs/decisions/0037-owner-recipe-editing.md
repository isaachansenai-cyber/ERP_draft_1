# 0037 Owner recipe editing

Operator decision (session, 2026-11-25).

- **Who:** the owner edits; managers read recipes (no costs are shown); employees have no Recipes screen and `get_recipes` refuses them.
- **What:** change per-serving amounts, add or remove ingredients (ING items only, in each ingredient's base unit, up to 6 decimals). No new dishes or new items.
- **How:** recipes stay immutable once active (0003). The owner works on a **draft** copy of the active version (one draft per dish), saves it (`draft_revision` catches edits from another window), then activates it with a required "what changed" note. The old version becomes `superseded` and is kept.
- **Orders:** an order line keeps the recipe version and requirements it was accepted with, so accepted, preparing and completed orders do not change, and kitchen start issues the original amounts. New orders, planning and What can we serve use the new version. Editing an accepted order builds a new revision at current prices and so uses the active recipe, the same as for prices.
- **Pilot gate:** activating does not reopen `recipes_verified`; the owner who edits is the person who confirms that gate. The audit log stores both versions' lines.
- **Labels:** lines the owner leaves unchanged keep their source label; changed or new lines are "Owner-entered".
