# Task Context: Task 2

Title: Add the durable synthesis cursor schema
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-78
Repository: opsclawd/regime-engine
Branch: ai/issue-78
Start Commit: c8bcac54261f45e46e11f79b38cc9d55167fe4f5

## Task Requirements

**Files:**

- Create: `drizzle/0009_create_policy_insight_synthesis_cursor.sql`
- Create: `drizzle/meta/0009_snapshot.json`
- Create: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Create: `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/ledger/pg/schema/index.ts`
- Modify: `src/ledger/pg/db.ts`
- Modify: `src/server.ts`
- Modify: `src/__tests__/pgStartup.test.ts`
- Reference: `drizzle/0008_widen_evidence_correlation_id.sql`
- Reference: `src/ledger/pg/schema/evidenceBundles.ts`

- [ ] **Step 1: Write failing migration and startup tests.** Name the cases `creates one pair synthesis cursor row per cursor key`, `enforces non-negative receipt and retry values`, `supports an expiring lease and classified outcome`, `resolves when policy_insight_synthesis_cursor exists`, and `fails startup when policy_insight_synthesis_cursor is missing`.
- [ ] **Step 2: Verify the focused tests fail.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts src/__tests__/pgStartup.test.ts`; expect the missing table/export assertions to fail.
- [ ] **Step 3: Add migration and Drizzle schema.** Create `regime_engine.policy_insight_synthesis_cursor` keyed by `cursor_key` with `last_processed_receipt_id`, nullable `target_receipt_id`, nullable `lease_owner`, nullable `lease_expires_at_unix_ms`, `attempt_count`, nullable `next_attempt_at_unix_ms`, nullable `last_outcome` constrained to `success`, `permanent_failure`, or `transient_failure`, nullable bounded `last_error_code`/`last_error_message`, and `updated_at_unix_ms`. Add checks for non-negative numeric values and coherent all-null/all-present lease fields. Export `policyInsightSynthesisCursor` plus inferred row/insert types from the schema index.
- [ ] **Step 4: Register migration metadata.** Generate the matching `0009_snapshot.json` and journal entry using the repository's existing Drizzle conventions; inspect the generated SQL and keep the migration additive and forward-only.
- [ ] **Step 5: Add startup verification.** Export `verifyPolicyInsightSynthesisCursorTable(db)` from `src/ledger/pg/db.ts`, invoke it in `src/server.ts` after evidence/policy table verification, and test both present and missing-table behavior.
- [ ] **Step 6: Run focused verification.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts src/__tests__/pgStartup.test.ts` and `pnpm exec eslint src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/schema/index.ts src/ledger/pg/db.ts src/server.ts src/__tests__/pgStartup.test.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`; expect pass/zero warnings. If Postgres is unavailable, record the PG test as unexecuted rather than treating a skipped test as proof.
- [ ] **Step 7: Commit.** Commit as `m78: persist pair synthesis cursor state`.

## Repository Targets

### Expected Files
- drizzle/0009_create_policy_insight_synthesis_cursor.sql
- drizzle/meta/0009_snapshot.json
- drizzle/meta/_journal.json
- src/ledger/pg/schema/policyInsightSynthesisCursor.ts
- src/ledger/pg/schema/index.ts
- src/ledger/pg/db.ts
- src/server.ts
- src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts
- src/__tests__/pgStartup.test.ts

### Reference Files
- drizzle/0008_widen_evidence_correlation_id.sql
- src/ledger/pg/schema/evidenceBundles.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts src/__tests__/pgStartup.test.ts
["pnpm","exec","eslint","src/ledger/pg/schema/policyInsightSynthesisCursor.ts","src/ledger/pg/schema/index.ts","src/ledger/pg/db.ts","src/server.ts","src/__tests__/pgStartup.test.ts","src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **one cursor per key**: The database permits only one mutable synthesis state row for each cursor key. (Test: `creates one pair synthesis cursor row per cursor key`)
- **coherent durable state**: Receipt IDs and attempt counts cannot be negative, and lease owner target and expiry fields are either all present or all absent. (Test: `enforces non-negative receipt and retry values`)
- **startup requires cursor table**: A Postgres-backed service aborts startup when the cursor migration has not been applied. (Test: `fails startup when policy_insight_synthesis_cursor is missing`)

