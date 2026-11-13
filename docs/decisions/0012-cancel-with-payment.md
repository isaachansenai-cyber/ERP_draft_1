# 0012 Cancelling an order that already has a recorded payment

- `cancel_order` refuses with `invalid_state:recorded_payment_requires_refund` when the order has any recorded tender.
- Reversing money is the refund workflow's job: original line linkage, the discount/tax snapshot, cumulative limits and owner/manager permission (PRD §7, AC16). Refunds arrive in Milestone 3 (CLAUDE.md §10).
- Until then, staff take payment after preparation, or the manager settles the external refund outside the app first. This is a temporary operating limitation, listed in PROGRESS.md.
