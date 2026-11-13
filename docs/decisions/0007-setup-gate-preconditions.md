# 0007 Setup-gate preconditions and staging

**Decision.**
- Confirming a gate requires the owner, an evidence note of at least 10 characters, and a server-checked precondition where the data model exists. For example, `tax_rate_confirmed` needs an owner-entered rate effective today, and `menu_prices_confirmed` needs a price for every sellable item.
- Gates whose workflows ship in later milestones (`opening_counts_posted`, `planning_inputs_confirmed`, `return_policy_configured`) return `setup_gate_precondition:<gate>` with `workflow_not_yet_available`, rather than accepting a confirmation nobody could verify.
- Gates are initial-setup attestations. Entering a later price or rate does not reopen them automatically. The owner can reopen any gate with a reason.
- Reopening `roles_verified`, `backup_restore_tested` or `acceptance_suite_passed` turns posting off.
