# 0021 Transfers: source cost, destination receipt, losses belong to the source

- Dispatch takes eligible, unreserved sellable stock first-expiry-first-out at the source's weighted-average cost, one transfer line per source lot. Stock then belongs to neither location's availability.
- Only the destination's manager (or the owner) records receipts. Received quantity enters a new destination lot (keeping the source lot code and use-by) at the line's dispatch cost. Expired arrivals are forced into quarantine.
- Losses need a `transfer` reason code. For reporting, transit losses and the value still in transit are attributed to the **source** location, which owned the stock at dispatch.
- Each line keeps `received + lost + in transit = dispatched`; a CHECK prevents over-receipt and in-transit quantity is a generated column (AC13).
