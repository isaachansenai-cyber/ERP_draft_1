# 0013 Demo opening stock is posted through the ledger

Supersedes ADR 0005. With the stock ledger in place, `import-demo-seed.ts` posts the 126 synthetic opening rows once per location using `private.post_opening_count`. That is the same internal path as the manager's opening-count RPC, minus the pilot-only gate and use-by checks. Each posting creates lots (provenance `synthetic_demo_opening`), opening movements, balances and weighted-average valuation. It is idempotent: a location that already has an opening count is skipped. Demo history is still never replayed against this stock.
