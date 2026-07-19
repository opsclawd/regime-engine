# Task Context: Task 5

Title: Add race-safe command persistence through the port and PostgreSQL adapter
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

- Create: `src/application/errors/policyInsightErrors.ts`
- Create: `src/application/ports/policyInsightRepositoryPort.ts`
- Create: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

**Port/interface rule:** This task introduces command methods and their only adapter together. Do not commit the port without the PostgreSQL implementation.

**Invariants implemented first:**

- `identical canonical inputs produce one stored insight`
- `concurrent identical inserts return the persisted winner`
- `repository unavailability never returns an unstored insight`

- [ ] **Step 1: Write failing PostgreSQL command tests**

  Test `findBySynthesisInputHash` miss/hit, first insert, exact replay, concurrent same-input insertion, changed-input insertion, canonical JSON round-trip, append-only behavior, and transient connection errors mapped to `PolicyInsightStoreUnavailableError`.

- [ ] **Step 2: Confirm RED**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

  Expected: FAIL because the port and adapter do not exist.

- [ ] **Step 3: Define the command port and audit record**

  ```ts
  export interface PolicyInsightRepositoryPort {
    findBySynthesisInputHash(input: {
      readonly schemaVersion: string;
      readonly rulesetVersion: string;
      readonly synthesisInputHash: string;
    }): Promise<StoredPolicyInsight | null>;

    insertOrGet(input: NewPolicyInsightRecord): Promise<{
      readonly status: "created" | "already_exists";
      readonly record: StoredPolicyInsight;
    }>;
  }
  ```

  `NewPolicyInsightRecord` must require every typed/indexed field, complete canonical input envelope, selection decisions/lineage, validated canonical output, output canonical string, and payload hash. `StoredPolicyInsight` must return the stored canonical #63 payload without reconstructing it from columns.

- [ ] **Step 4: Implement atomic insert-or-return-existing**

  Use one transaction and `ON CONFLICT DO NOTHING` on the unique input tuple. If insertion loses, select the winner by the same tuple and return it. If the conflict fires but no winner can be read, throw an append-only invariant error. Never update/delete a row and never fall back to memory.

- [ ] **Step 5: Verify the port and adapter together**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

  Run: `pnpm exec eslint src/application/errors/policyInsightErrors.ts src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

  Expected: race tests return one row/insight ID and failure tests return no fabricated record.

- [ ] **Step 6: Commit the task**

  Run: `git add src/application/errors/policyInsightErrors.ts src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts && git commit -m "m61: persist synthesized insights idempotently"`

## Repository Targets

### Expected Files
- src/application/errors/policyInsightErrors.ts
- src/application/ports/policyInsightRepositoryPort.ts
- src/adapters/postgres/postgresPolicyInsightRepository.ts
- src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts
pnpm exec eslint src/application/errors/policyInsightErrors.ts src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **idempotent exact replay**: Sequential retries with an identical canonical input return one stored insight. (Test: `identical canonical inputs produce one stored insight`)
- **race-safe winner**: Concurrent identical inserts return the same persisted winner without update or duplicate history. (Test: `concurrent identical inserts return the persisted winner`)
- **no persistence fallback**: A transient PostgreSQL failure maps to the explicit unavailable error and returns no in-memory record. (Test: `repository unavailability never returns an unstored insight`)

