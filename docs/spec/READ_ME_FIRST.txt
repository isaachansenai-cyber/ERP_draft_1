MEATS AROUND THE WORLD ERP MVP PACKAGE
Version 1.0 | November 12, 2026

START HERE
1. Review ERP_MVP_PRD.pdf or edit ERP_MVP_PRD.docx.
2. Inspect ERP_Seed_and_Setup.xlsx. Source values and synthetic assumptions are identified in the columns and Read me sheet.
3. Give the build agent ERP_AI_Build_Brief.txt, ERP_MVP_PRD.txt, Acceptance_Checklist.csv and the data folder together.
4. Require the agent to follow the phased build and report actual test evidence. The supplied acceptance checklist is a specification, not a record of an implemented app passing tests.

FILES
ERP_MVP_PRD.docx / .pdf / .txt: Same finalized specification in three formats.
ERP_AI_Build_Brief.txt: Instructions to accompany the PRD and seed data.
ERP_Seed_and_Setup.xlsx: Editable source and demo setup review workbook.
Acceptance_Checklist.csv: 34 required application checks, initially NOT_RUN.
Source_Audit.txt: Source ranges, consistency checks and known gaps.
Data_Validation_Report.txt: Checks actually performed on the delivered data/files, distinct from future application acceptance tests.
data/source_master_data.json: Source-only IDs, item/recipe/supplier/lead-time normalization, including unverified source facts.
data/demo_seed.json: Generated demo master data, settings, customers, role fixtures and opening stock. Never import into the real pilot project.
data/historical_orders_demo.csv and historical_order_lines_demo.csv: Synthetic completed-order sales snapshots; no stock posting.
data/history_method.json: Generation assumptions, date range and deterministic seed.
data/seed_summary.json: Counts and expected totals for import verification.
tools/generate_demo_data.py: Recreates the demo fixtures and workbook locally from the normalized source data. Requires Python and openpyxl. It does not connect to Supabase or deploy anything.

SCOPE DECISIONS
Internal pilot with real staff/inventory; no live payment processing. Three locations: Provo, Spanish Fork, Salt Lake City. Staff order entry. Simplified made-to-order ingredient issues. Basic schedules/timekeeping and invoice/manual payment tracking are included. Full payroll, general ledger, customer ordering and batch production are deferred.

DEMO DATA
The source contains 40 ingredients, five dishes, 66 recipe lines and 15 suppliers. The demo adds two retail sauces, 10 customers and 10 staff/role fixtures. It includes 12,775 synthetic orders and 16,501 lines from May 1 to October 31, 2026, covering all 184 days and three locations. The demo stock reference date is November 1, 2026. Historical snapshots do not change those opening balances.

Data generation uses weekday, season, location, growth, promotion and bounded-variation factors. None is an observation of actual business performance. The sample tax rate, costs, menu prices, packs, payment terms and reorder/EOQ settings are not verified operating values. Source lead times are estimates. Missing actual contact fields are left missing; demo emails use example.invalid.

PILOT SETUP
Use a separate Supabase project. Confirm supplier contacts, actual packs/costs/terms/lead times, recipe portions/yields, menu prices, taxes, return policy and reorder inputs. Enter actual staff identities securely and count actual stock by location/lot. Complete server-side permission, transaction and restore checks before real data entry. The simplified production model does not track prepared-food batches or overnight-prep stock.

OPEN REQUIREMENT
The to-do list references 12 exact grading requirements, but their text was not supplied. The PRD maps visible requirements and explicitly leaves exact rubric coverage unverified.
