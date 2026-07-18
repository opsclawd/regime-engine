# Task Context: Task 4

Title: Implement exact-scope current evidence use case
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-59
Repository: opsclawd/regime-engine
Branch: ai/issue-59
Start Commit: 90e95da66c50bf9c462dfa0d552e3b13bce9a965

## Task Requirements

**Files:**

- Create: `src/application/use-cases/getCurrentEvidenceUseCase.ts`
- Create: `src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts`

- [ ] **Step 1: Write failing exact-query tests**

For pair, Whirlpool, wallet, and position inputs, assert the fake repository receives `pair: "SOL/USDC"`, the exact supplied `Scope`, `source` unchanged (`null`, publisher-only, source-only, or both), and one fixed `nowUnixMs`. Assert records remain in repository order and include stale/expired entries.

Run: `pnpm vitest run src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts`

Expected: FAIL because the use case does not exist.

- [ ] **Step 2: Implement the exported use-case shape**

```ts
export type GetCurrentEvidenceUseCase = (input: {
  scope: Scope;
  source: EvidenceSourceFilter | null;
}) => Promise<{ queriedAtUnixMs: number; records: EvidenceBundleRecord[] }>;
```

The factory accepts `{ repository, clock }`, calls the clock once, passes that value to `repository.getLatest`, and returns it as `queriedAtUnixMs`. It must not sort, select, or filter records after the repository.

- [ ] **Step 3: Verify and commit**

Run: `pnpm vitest run src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts`

Expected: PASS.

Commit: `git add src/application/use-cases/getCurrentEvidenceUseCase.ts src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts && git commit -m "m59: add current evidence use case"`

## Repository Targets

### Expected Files
- src/application/use-cases/getCurrentEvidenceUseCase.ts
- src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts

## Validation Commands

```bash
pnpm vitest run src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **queries current at one injected instant**: The exact scope and independent source filters are passed to getLatest with one clock value, and repository order and lifecycle records are returned unchanged. (Test: `queries current at one injected instant`)

