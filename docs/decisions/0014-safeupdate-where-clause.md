# 0014 Single-row updates need a WHERE clause (bug fix)

Supabase API sessions load `pg-safeupdate`, which rejects `UPDATE` and `DELETE` statements without a `WHERE` clause, even inside `SECURITY DEFINER` functions. `enable_posting` and `reopen_setup_gate` (migration 0007) updated the `app_settings` singleton without one. Their success paths therefore failed through the API. Milestone 1 tests only exercised the refusal path, so this went unnoticed. Milestone 2's pilot-operations setup found it.

Migration **0014** redefines both functions with `where singleton`. The earlier migration is not edited, because it was already pushed. Every new function writes `where` clauses on every UPDATE/DELETE.
