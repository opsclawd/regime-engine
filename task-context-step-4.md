# Task Context: Task 4

Title: Create the append-only policy insight schema and migration
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-61
Repository: opsclawd/regime-engine
Branch: ai/issue-61
Start Commit: 8eb83b2403a525df9fbb640f75379bc56dc7bc3c

## Task Requirements

**Files:**

- Create: `src/ledger/pg/schema/policyInsights.ts`
- Modify: `src/ledger/pg/schema/index.ts`
- Create: `src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts`
- Create: `src/ledger/pg/__tests__/policyInsightsMigration.test.ts`
- Create: `drizzle/0006_create_policy_insights.sql`
- Create: `drizzle/meta/0006_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write failing schema-shape and migration tests**

  Add named tests `rejects duplicate canonical synthesis input` and `enforces policy insight audit checks without legacy foreign keys`. Assert all audit columns, JSONB payloads, lowercase 64-character hash checks, timestamp ordering, unique `(schema_version, ruleset_version, synthesis_input_hash)`, unique canonical insight ID, and current/history indexes. The migration test must migrate an empty database, insert one valid row, reject invalid hashes/timestamps/duplicate inputs, and prove no foreign key to legacy `clmm_insights` exists.

- [ ] **Step 2: Confirm RED**

  Run: `pnpm exec vitest run src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts`

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsMigration.test.ts`

  Expected: FAIL because the schema/table/migration do not exist.

- [ ] **Step 3: Add the Drizzle schema and generated migration artifacts**

  Define `regime_engine.policy_insights` with surrogate `id`, canonical `insight_id`, schema/ruleset versions, pair/scope/optional position ID, generated/as-of/expiry/persisted times, market/position/selection/input hashes, selection-policy version, canonical input JSON, canonical output JSON, output canonical text/hash, and selected/excluded lineage JSON. Add only INSERT-oriented indexes; no update timestamp or mutable status column.

- [ ] **Step 4: Verify schema and migration behavior**

  Run: `pnpm exec vitest run src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts`

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsMigration.test.ts`

  Run: `pnpm exec eslint src/ledger/pg/schema/policyInsights.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts src/ledger/pg/__tests__/policyInsightsMigration.test.ts`

  Expected: schema and migration tests pass against a migrated PostgreSQL database.

- [ ] **Step 5: Commit the task**

  Run: `git add src/ledger/pg/schema/policyInsights.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts src/ledger/pg/__tests__/policyInsightsMigration.test.ts drizzle/0006_create_policy_insights.sql drizzle/meta/0006_snapshot.json drizzle/meta/_journal.json && git commit -m "m61: add append-only policy insight storage"`

## Repository Targets

### Expected Files
- src/ledger/pg/schema/policyInsights.ts
- src/ledger/pg/schema/index.ts
- src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts
- src/ledger/pg/__tests__/policyInsightsMigration.test.ts
- drizzle/0006_create_policy_insights.sql
- drizzle/meta/0006_snapshot.json
- drizzle/meta/_journal.json

## Validation Commands

```bash
pnpm exec vitest run src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsMigration.test.ts
pnpm exec eslint src/ledger/pg/schema/policyInsights.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts src/ledger/pg/__tests__/policyInsightsMigration.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **unique canonical synthesis input**: The database rejects a duplicate schema-version, ruleset-version, and synthesis-input-hash tuple. (Test: `rejects duplicate canonical synthesis input`)
- **valid immutable audit shape**: Hash format and timestamp-order checks reject malformed audit rows and the table has no legacy insight dependency. (Test: `enforces policy insight audit checks without legacy foreign keys`)

