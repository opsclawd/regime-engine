# Task Context: Task 8

Title: Add stable cursor history through the port and adapter
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

- Modify: `src/application/ports/policyInsightRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts`
- Create: `src/application/use-cases/getPolicyInsightHistoryUseCase.ts`
- Create: `src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

**Port/interface rule:** Add `getHistory` and its PostgreSQL implementation in this same task.

**Invariants implemented first:**

- `history pagination is stable across equal generation timestamps`
- `history returns changed canonical inputs as distinct rows`
- `history never returns legacy externally authored rows`

- [ ] **Step 1: Write failing history tests**

  Cover empty history, default/max limit, invalid limits, exact scope filtering, equal-timestamp tie-breaking, cursor encode/decode round-trip, no duplicates or gaps across pages, and canonical JSON round-trip.

- [ ] **Step 2: Confirm RED**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

  Expected: FAIL because history support does not exist.

- [ ] **Step 3: Add the port method, adapter query, and use case together**

  ```ts
  export interface PolicyInsightHistoryCursor {
    readonly generatedAtUnixMs: number;
    readonly id: number;
  }

  getHistory(input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly limit: number;
    readonly cursor: PolicyInsightHistoryCursor | null;
  }): Promise<{
    readonly records: readonly StoredPolicyInsight[];
    readonly nextCursor: PolicyInsightHistoryCursor | null;
  }>;
  ```

  Query with the strict tuple predicate `(generated_at_unix_ms, id) < (cursor.generatedAtUnixMs, cursor.id)`, request `limit + 1`, and derive the next cursor from the last returned item. Map results into #63's history envelope in the use case, not the repository.

- [ ] **Step 4: Verify pagination**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

  Run: `pnpm exec eslint src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/getPolicyInsightHistoryUseCase.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

- [ ] **Step 5: Commit the task**

  Run: `git add src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/getPolicyInsightHistoryUseCase.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts && git commit -m "m61: paginate canonical policy insight history"`

## Repository Targets

### Expected Files
- src/application/ports/policyInsightRepositoryPort.ts
- src/adapters/postgres/postgresPolicyInsightRepository.ts
- src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts
- src/application/use-cases/getPolicyInsightHistoryUseCase.ts
- src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts
pnpm exec eslint src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/getPolicyInsightHistoryUseCase.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **stable tuple cursor**: Equal generation timestamps page without duplicates or gaps by using row ID as the tie-breaker. (Test: `history pagination is stable across equal generation timestamps`)
- **changed inputs remain historical**: Distinct synthesis input hashes are retained and returned as separate ordered rows. (Test: `history returns changed canonical inputs as distinct rows`)
- **canonical history isolation**: History reads only policy_insights and ignores externally authored legacy rows. (Test: `history never returns legacy externally authored rows`)

