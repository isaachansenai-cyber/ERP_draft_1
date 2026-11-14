# 0017 Refund amounts come from line snapshots; the last unit takes the remainder

- A refund names order lines and either whole units or a net amount. It is computed from the line's snapshotted net (after the allocated discount) and tax, never from current prices or rates.
- A partial-unit refund is `round(line net × units ÷ quantity)`. The refund that reaches the line's last unit (or last cent of net) takes exactly what remains, so the cumulative net and tax per line always equal the recorded amounts and never exceed them.
- Tax follows net proportionally, with the same final-remainder rule. The per-order total of refunds cannot exceed the recorded payments.
- Only completed orders are refunded. An order that has not been picked up is cancelled instead, and `cancel_order` now records the refund of whatever was paid in the same transaction (kind `cancellation`, manager approval required). Its net/tax split follows the order's totals. This **supersedes ADR 0012**.
- Refunds always need owner/manager authority: a manager's own session, or an employee with a manager PIN on a shared tablet (D5).
