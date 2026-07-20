# Plan Review Findings

## verdict

pass

## findings

- [P1] `task-manifest.json:Task 4` | "Task 4 alters the database schema in `src/ledger/pg/schema/policyInsights.ts` to add the nullable `wire_contract_sha256` column. This changes the required member shapes of the exported `policyInsights` table object, as well as the exported `PolicyInsightRow` and `PolicyInsightInsert` inferred types. These exported API surfaces are missing from the `signature_changes` array, violating the rule that all exported signature shape changes must be declared." | grounded | addressed
