# 0001 Authorize before the idempotency lookup

**Context.** CLAUDE.md §5.4 lists the idempotency lookup first in the RPC template.
**Decision.** RPCs resolve the actor and check authorization *before* consulting `private.request_log`. The idempotency scope is still (actor, request key). The RPC name is stored, and reusing a key for a different RPC is rejected (`conflict:request_key_reused`).
**Why.** A caller whose role was revoked must not be able to replay an earlier result. Replays stay scoped to the same actor, so no other user's result can leak.
**Concurrency.** `idem_begin` inserts a pending row first. A concurrent duplicate blocks on the primary key and then reads the committed result, so it never executes twice (integration test: "two concurrent submissions with the same key"). A raised error rolls the pending row back, so a rejected request can be retried with the same key after the input is fixed.
