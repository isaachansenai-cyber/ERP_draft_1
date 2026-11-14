# 0004 Demo mode switch and reset are operator scripts, not endpoints

**Decision.**
- Migrations always create a **pilot** database.
- `private.enable_demo_mode()` switches a database to demo mode only if it is pristine: no staff, customers, prices, taxes, history, confirmed gates or non-import audit rows.
- `private.reset_demo_data()` refuses unless the database is in demo mode.
- Neither function is granted to any API role, including `service_role`. They run only through `scripts/demo/*` with direct database credentials.
- The scripts also require the target ref, taken from the environment only, to be in `DEMO_PROJECT_REF_ALLOWLIST`.

**Why.** PRD §15 requires that the pilot have no seed or reset endpoint, and that demo reset cannot target the pilot or accept an arbitrary project identifier. An operator holding the demo database credentials stands in for "owner-only". Triggers also reject synthetic rows and block truncation while the database is in pilot mode, so a misconfigured script still cannot write demo data into the pilot.
