# Task Context: Task 1

Title: Add the indexed SQLite position-plan read model
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-79
Repository: opsclawd/regime-engine
Branch: ai/issue-79
Start Commit: d64e12669d308cc998d484d6eb84f9e0cbc35898

## Task Requirements

**Files:**

- Modify: `src/ledger/schema.sql`
- Modify: `src/ledger/store.ts`
- Modify: `src/ledger/writer.ts`
- Modify: `src/application/ports/planLedgerPort.ts`
- Create: `src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts`
- Create: `src/ledger/__tests__/planLedgerPositionMigration.test.ts`
- Create: `src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts`

**Exported API changes:** Add `StoredPositionPlan` and `PlanLedgerReadPort`, with `getLatestPositionPlan(scope)`, `getPositionPlanByHash(scope, planHash)`, and `listLatestPositionPlans()`. Keep `PlanLedgerWritePort.writePlan` unchanged.

**Behavioral invariants / tests written first:**

- `migrates an existing plan ledger and backfills position lookup columns from canonical request JSON`: an old database gains `position_id`, `wallet_id`, and `pool_address` without losing rows.
- `enables WAL for a file-backed ledger used by the HTTP process and worker`: a file ledger reports `journal_mode=wal`; `:memory:` remains supported.
- `writes denormalized position identity with the canonical request and plan in one transaction`: either both ledger rows exist or neither does.
- `returns the exact latest request and response for a matching wallet position and pool`: ordering is `plans.as_of_unix_ms DESC, plans.id DESC` and no JSON scan is used.
- `returns the exact historical plan selected by plan hash`: the adapter does not reconstruct or substitute fields.
- `lists one latest wallet identified plan per position and pool for deployment reconciliation`: plan-only scopes are discoverable even when Postgres has no evidence.
- `does not match a missing wallet or a different position or pool`: exact identity is mandatory.

- [ ] Add failing migration and adapter tests. Construct a legacy SQLite file with the old table shape, reopen it through `createLedgerStore`, and assert the backfill and query plan via `EXPLAIN QUERY PLAN` uses `idx_plan_requests_position_lookup`.
- [ ] Run `pnpm exec vitest run src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts`; expect failures for absent columns/read adapter.
- [ ] Change the fresh-install `plan_requests` definition to include the three lookup columns and an index on `(position_id, wallet_id, pool_address, as_of_unix_ms DESC, id DESC)`. In `createLedgerStore`, run a transactionally guarded compatibility migration that inspects `PRAGMA table_info(plan_requests)`, adds missing columns, parses each canonical `request_json`, backfills identities, then creates the index. Set `PRAGMA journal_mode=WAL` for file databases before normal traffic.
- [ ] Extend the writer insert to store `planRequest.position.positionId`, `planRequest.position.walletId ?? null`, and `planRequest.market.poolAddress`. Implement both read methods by joining `plan_requests` and `plans` on `plan_id`, parsing the stored JSON, and returning the exact pair:

```ts
export interface StoredPositionPlan {
  readonly planRequest: PlanRequest;
  readonly planResponse: PlanResponse;
}

export interface PlanLedgerReadPort {
  getLatestPositionPlan(scope: PositionPlanScope): Promise<StoredPositionPlan | null>;
  getPositionPlanByHash(
    scope: PositionPlanScope,
    planHash: string
  ): Promise<StoredPositionPlan | null>;
  listLatestPositionPlans(): Promise<readonly StoredPositionPlan[]>;
}
```

- [ ] Re-run the targeted Vitest command and `pnpm exec eslint src/ledger/store.ts src/ledger/writer.ts src/application/ports/planLedgerPort.ts src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts`; expect all checks to pass. The automatic implementation gate then runs `pnpm -r typecheck`.
- [ ] Commit with `git add src/ledger/schema.sql src/ledger/store.ts src/ledger/writer.ts src/application/ports/planLedgerPort.ts src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts && git commit -m "m79: index and read position plans"`.

## Repository Targets

### Expected Files
- src/ledger/schema.sql
- src/ledger/store.ts
- src/ledger/writer.ts
- src/application/ports/planLedgerPort.ts
- src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts
- src/ledger/__tests__/planLedgerPositionMigration.test.ts
- src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts

### Reference Files
- src/contract/v1/types.ts
- src/contract/v1/validation.ts

## Validation Commands

```bash
pnpm exec vitest run src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts
pnpm exec eslint src/ledger/store.ts src/ledger/writer.ts src/application/ports/planLedgerPort.ts src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **legacy ledger backfill**: Opening an old ledger adds and backfills position lookup columns without losing canonical rows. (Test: `migrates an existing plan ledger and backfills position lookup columns from canonical request JSON`)
- **atomic denormalized write**: Canonical request/plan rows and denormalized position identity commit or roll back together. (Test: `writes denormalized position identity with the canonical request and plan in one transaction`)
- **exact latest lookup**: Latest lookup matches wallet, position, and pool and returns the exact stored JSON pair through the index. (Test: `returns the exact latest request and response for a matching wallet position and pool`)
- **plan scope discovery**: Deployment reconciliation can discover the latest wallet-identified plan even when evidence is absent. (Test: `lists one latest wallet identified plan per position and pool for deployment reconciliation`)

