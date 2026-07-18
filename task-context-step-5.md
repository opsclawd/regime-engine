# Task Context: Task 5

Title: Implement bounded evidence history use case
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

- Create: `src/application/use-cases/getEvidenceHistoryUseCase.ts`
- Create: `src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts`

- [ ] **Step 1: Write failing page pass-through tests**

Assert default/explicit limits, null/non-null cursors, all exact scopes, source filters, one clock call, record order, and `nextCursor` pass through unchanged. Use the exact case `queries one bounded history page at one injected instant`.

Run: `pnpm vitest run src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts`

Expected: FAIL because the use case does not exist.

- [ ] **Step 2: Implement the exported use-case shape**

```ts
export type GetEvidenceHistoryUseCase = (input: {
  scope: Scope;
  source: EvidenceSourceFilter | null;
  limit: number;
  cursor: EvidenceHistoryCursor | null;
}) => Promise<{
  queriedAtUnixMs: number;
  records: EvidenceBundleRecord[];
  nextCursor: EvidenceHistoryCursor | null;
}>;
```

The factory accepts `{ repository, clock }`, captures one `queriedAtUnixMs`, and delegates. HTTP validates `1..100`; the repository remains the defensive limit backstop.

- [ ] **Step 3: Verify and commit**

Run: `pnpm vitest run src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts`

Expected: PASS.

Commit: `git add src/application/use-cases/getEvidenceHistoryUseCase.ts src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts && git commit -m "m59: add evidence history use case"`

## Repository Targets

### Expected Files
- src/application/use-cases/getEvidenceHistoryUseCase.ts
- src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts

## Validation Commands

```bash
pnpm vitest run src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **queries one bounded history page at one injected instant**: Scope, source filters, validated limit, and decoded cursor pass through with one clock value; repository record order and nextCursor remain unchanged. (Test: `queries one bounded history page at one injected instant`)

