# 0006 Manager PIN failures are returned, not raised

**Context.** The manager PIN (CLAUDE.md D5) locks after 5 failures for 15 minutes. If an approval RPC raised an exception on a wrong PIN, the failure-counter update would roll back with it, and the lockout could never trigger.
**Decision.** `private.check_manager_pin()` never raises. It updates the counters and returns `NULL` (approved) or a code: `pin_invalid`, `pin_locked`, `pin_not_set` or `approver_not_authorized`. Approval-requiring RPCs (Milestone 2 onward) must, on a non-NULL code, call `private.idem_abandon()`, make no business writes, and *return* an error result so the counter commits.
**Also.** PINs must be 6–12 digits. Repeated or sequential digits are rejected. Only a bcrypt hash is stored, and the PIN never appears in audit rows.
