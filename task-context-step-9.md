# Task Context: Task 9

Title: Implement paginated evidence history handler
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

- Create: `src/adapters/http/handlers/evidenceHistory.ts`
- Create: `src/adapters/http/handlers/__tests__/evidenceHistory.test.ts`

- [ ] **Step 1: Write failing history-response tests**

Cover default/maximum limits, decoded cursor pass-through, malformed cursor `400`, all scopes/source filters, null/typed unavailable `503`, empty successful collection, ordered non-empty items, encoded next cursor, and redacted unknown `500`.

Run: `pnpm vitest run src/adapters/http/handlers/__tests__/evidenceHistory.test.ts`

Expected: FAIL because the handler does not exist.

- [ ] **Step 2: Implement history mapping**

`createEvidenceHistoryHandler(useCase: GetEvidenceHistoryUseCase | null)` parses strict history query state and sends `schemaVersion`, pair, normalized scope, `queriedAt`, effective `limit`, mapped `items`, and `nextCursor: nextCursor ? encodeEvidenceCursor(nextCursor) : null`. Empty history is always `200`, never `404`.

- [ ] **Step 3: Verify and commit**

Run: `pnpm vitest run src/adapters/http/handlers/__tests__/evidenceHistory.test.ts`

Expected: PASS.

Commit: `git add src/adapters/http/handlers/evidenceHistory.ts src/adapters/http/handlers/__tests__/evidenceHistory.test.ts && git commit -m "m59: add evidence history handler"`

## Repository Targets

### Expected Files
- src/adapters/http/handlers/evidenceHistory.ts
- src/adapters/http/handlers/__tests__/evidenceHistory.test.ts

## Validation Commands

```bash
pnpm vitest run src/adapters/http/handlers/__tests__/evidenceHistory.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **returns empty history as a collection**: No history records yields 200 with an empty items array and null cursor; pages retain repository order and encode only the returned next cursor. (Test: `returns empty history as a collection`)

