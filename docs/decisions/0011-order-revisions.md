# 0011 Order edits create a new revision

PRD §7 allows an accepted order to be edited, as long as the reservations are replaced atomically.

- Order lines are append-only. An edit (`edit_accepted_order`) checks the version, releases every active allocation, writes a **new revision** of lines priced at today's effective price and tax rate, and reserves the new requirements, all in one transaction. A shortage rolls the whole edit back.
- Earlier revisions stay for audit. Reports and the kitchen read only `orders.revision`.
- An edit is a re-acceptance, so it re-snapshots price, tax and recipe. Accepted orders that are *not* edited keep their original snapshots (AC09).
- Recorded payments may not exceed the new total.
