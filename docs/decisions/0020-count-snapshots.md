# 0020 Count snapshots use the movement number; whole-count rejection

- Starting a count locks the counted items' balances, records the highest movement number for those items at the location, and snapshots each lot/condition balance as the expected quantity.
- Posting rejects the **whole** count with `conflict:stock_changed_since_count` if any movement for a counted item was posted after the snapshot. The manager cancels it and starts again; partial posting of an inconsistent count is never attempted.
- Lines left blank are recorded as counted = expected. A count can never go below the quantity reserved on that lot, so accepted orders keep their reservations (AC11).
- Count gains are valued at the current weighted average and losses issue at the current average (D11). Every adjustment carries the reason code (default `COUNT_VARIANCE`).
