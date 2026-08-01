# Task Context: Task 1

Title: Add the dual-pointer cursor migration and schema constraints
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-84
Repository: opsclawd/regime-engine
Branch: ai/issue-84
Start Commit: fe6cd852f09f3928795fb106d28125a71fbc74d7

## Task Requirements

**Files:**

- Modify: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Create: `drizzle/0011_extend_policy_insight_synthesis_cursor.sql`
- Create: `drizzle/meta/0011_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`
- Reference only: `drizzle/0009_create_policy_insight_synthesis_cursor.sql`
- Reference only: `src/ledger/pg/schema/srThesesV2.ts`
- Reference only: `src/ledger/pg/schema/index.ts`
- Reference only: `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`

**Behavioral invariants:**

- `defaults the SR last-processed cursor to zero for existing and new rows`
- `requires both claim targets whenever a lease is active`
- `rejects negative SR cursor values`

- [ ] **Step 1: Write the failing migration tests.** Extend the insert/select assertions with `last_processed_sr_theses_max_id` and `target_sr_theses_max_id`. Add focused cases that verify migration backfills `target_sr_theses_max_id = 0` for active legacy leases, insert of negative SR values is rejected, and all three valid lease/target states (idle, leased, and retry cooldown) are validated. Keep the existing primary-key, legacy non-negative, and outcome checks.

  The new assertions should use the exact test names above and explicitly verify an insert that omits `last_processed_sr_theses_max_id` reads back as numeric `0`.

- [ ] **Step 2: Run the focused migration test and confirm it fails because the SR cursor columns do not exist.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`

  Expected: FAIL on the first reference to `last_processed_sr_theses_max_id` or `target_sr_theses_max_id`, before the migration is added and applied.

- [ ] **Step 3: Extend the Drizzle table definition.** Add:

  ```ts
  lastProcessedSrThesesMaxId: bigint("last_processed_sr_theses_max_id", {
    mode: "number"
  })
    .notNull()
    .default(0),
  targetSrThesesMaxId: bigint("target_sr_theses_max_id", { mode: "number" }),
  ```

  Extend `chk_synthesis_cursor_non_negative` so both new values are non-negative (with the target nullable). Extend `chk_synthesis_cursor_lease_coherence` to cover all three valid cursor states: idle (`leaseOwner` NULL, `targetReceiptId` NULL, `targetSrThesesMaxId` NULL, `nextAttemptAtUnixMs` NULL), leased (`leaseOwner` NOT NULL, `leaseExpiresAtUnixMs` NOT NULL, `targetReceiptId` NOT NULL, `targetSrThesesMaxId` NOT NULL), and retry cooldown (`leaseOwner` NULL, `leaseExpiresAtUnixMs` NULL, `targetReceiptId` NOT NULL, `targetSrThesesMaxId` NOT NULL, `nextAttemptAtUnixMs` NOT NULL).

- [ ] **Step 4: Generate and inspect the additive migration artifacts.**

  Run: `pnpm exec drizzle-kit generate --name=extend_policy_insight_synthesis_cursor`

  Expected: creates `drizzle/0011_extend_policy_insight_synthesis_cursor.sql`, `drizzle/meta/0011_snapshot.json`, and appends entry 11 to `drizzle/meta/_journal.json`.

  Inspect the SQL and keep only an additive/backward-safe sequence: add `last_processed_sr_theses_max_id bigint DEFAULT 0 NOT NULL`, add nullable `target_sr_theses_max_id`, backfill existing active and retry-cooldown leases (`UPDATE regime_engine.policy_insight_synthesis_cursor SET target_sr_theses_max_id = 0 WHERE (lease_owner IS NOT NULL OR target_receipt_id IS NOT NULL) AND target_sr_theses_max_id IS NULL;`), drop the two named cursor constraints, then recreate them with both pointer components supporting idle, leased, and retry-cooldown cursor states. Do not drop/recreate the table or alter unrelated objects.

- [ ] **Step 5: Apply the migration to the test database and run the focused tests.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate`

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`

  Expected: migration applies once; the focused test passes and confirms defaulting, non-negativity, and lease coherence.

- [ ] **Step 6: Check only the changed TypeScript files for lint/format issues.**

  Run: `pnpm exec eslint src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`

  Run: `pnpm exec prettier --check src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts drizzle/0011_extend_policy_insight_synthesis_cursor.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json`

  Expected: both commands exit 0.

- [ ] **Step 7: Commit the schema unit.**

  ```bash
  git add src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts drizzle/0011_extend_policy_insight_synthesis_cursor.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json
  git commit -m "m84: add dual-source synthesis cursor"
  ```

## Repository Targets

### Expected Files
- src/ledger/pg/schema/policyInsightSynthesisCursor.ts
- drizzle/0011_extend_policy_insight_synthesis_cursor.sql
- drizzle/meta/0011_snapshot.json
- drizzle/meta/_journal.json
- src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts

### Reference Files
- drizzle/0009_create_policy_insight_synthesis_cursor.sql
- src/ledger/pg/schema/srThesesV2.ts
- src/ledger/pg/schema/index.ts
- src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts
["pnpm","exec","eslint","src/ledger/pg/schema/policyInsightSynthesisCursor.ts","src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts"]
["pnpm","exec","prettier","--check","src/ledger/pg/schema/policyInsightSynthesisCursor.ts","src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts","drizzle/0011_extend_policy_insight_synthesis_cursor.sql","drizzle/meta/0011_snapshot.json","drizzle/meta/_journal.json"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **SR cursor defaults to zero**: Existing and newly inserted cursor rows use zero as the last-processed SR high-water mark unless explicitly supplied. (Test: `defaults the SR last-processed cursor to zero for existing and new rows`)
- **Dual-target lease coherence**: An active lease has owner, expiry, evidence target, and SR target; an idle cursor has all four fields null. (Test: `requires both claim targets whenever a lease is active`)
- **Non-negative SR pointers**: The database rejects negative last-processed or target SR IDs while allowing a null target. (Test: `rejects negative SR cursor values`)

