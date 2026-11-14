# 0030 How performance was measured (AC33)

- The PRD sizes the pilot at 20 concurrent sessions and 50,000 order lines plus the demo history. The demo has 16,501 history lines but few operational orders, so `scripts/perf/load-test.ts` first bulk-inserts completed synthetic orders labeled `synthetic_perf_volume` until there are 50,000 operational order lines. These rows exist only in a demo database (the script refuses pilot databases), post no stock movements, and are cleared by demo reset.
- Sessions are the 10 demo role users signed in twice each. Their scenarios follow the roles: employees run the POS → kitchen → payment → pickup flow plus the serve view; managers run stock, 30-day sales, forecast, projection, serve, invoices and hours; the owner runs all-location and historical summaries.
- Business refusals (for example `insufficient_stock` when a dish runs out) count as correct outcomes, not errors. Any other error fails the run, as does any broken ledger invariant afterwards.
- The measurement ran on the local Docker stack, so network latency to a hosted project is not included. The report says so, and a rerun against the hosted demo is listed as a go-live step.
