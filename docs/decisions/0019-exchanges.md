# 0019 Exchanges are one transaction with an exchange-credit tender

- `process_exchange` writes the return (into custody), a refund with method `exchange_credit` for the returned units' original net + tax, and a new retail order priced, taxed and reserved like any order. If the replacement is short, the whole call rolls back: no return, refund, order or movement remains (AC14).
- The credit is applied to the new order as a tender with method `exchange_credit` (referencing the refund number). If the credit exceeds the replacement, the excess is recorded as paid out by the chosen external method; if it is lower, the new order stays `ready` with the balance due, to be collected and completed normally.
- A replacement fully covered by the credit is handed over at once (retail units consumed). Exchanges are retail-only.
