# Task Context: Task 8

Title: Implement current evidence handler
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

- Create: `src/adapters/http/handlers/evidenceCurrent.ts`
- Create: `src/adapters/http/handlers/__tests__/evidenceCurrent.test.ts`

- [ ] **Step 1: Write failing current-response tests**

Cover every parsed scope, independent source filters, strict validation details, null/typed unavailable `503`, empty `404`, multiple publisher/source items in returned order, stale/expired visibility, complete bundle provenance, one `queriedAt` ISO, and redacted unknown `500`.

Run: `pnpm vitest run src/adapters/http/handlers/__tests__/evidenceCurrent.test.ts`

Expected: FAIL because the handler does not exist.

- [ ] **Step 2: Implement current mapping**

`createEvidenceCurrentHandler(useCase: GetCurrentEvidenceUseCase | null)` parses with `parseEvidenceCurrentQuery`, calls the use case, and sends:

```ts
{
  schemaVersion: EVIDENCE_SCHEMA_VERSION,
  pair: "SOL/USDC",
  scope,
  queriedAt: new Date(queriedAtUnixMs).toISOString(),
  items: records.map(toEvidenceWireItem)
}
```

An empty result is `404 EVIDENCE_NOT_FOUND`; do not discard expired records or choose a winner.

- [ ] **Step 3: Verify and commit**

Run: `pnpm vitest run src/adapters/http/handlers/__tests__/evidenceCurrent.test.ts`

Expected: PASS.

Commit: `git add src/adapters/http/handlers/evidenceCurrent.ts src/adapters/http/handlers/__tests__/evidenceCurrent.test.ts && git commit -m "m59: add current evidence handler"`

## Repository Targets

### Expected Files
- src/adapters/http/handlers/evidenceCurrent.ts
- src/adapters/http/handlers/__tests__/evidenceCurrent.test.ts

## Validation Commands

```bash
pnpm vitest run src/adapters/http/handlers/__tests__/evidenceCurrent.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **returns all current sources without selecting**: All ordered repository records, including stale and expired records with complete bundles, are returned; only an empty result maps to EVIDENCE_NOT_FOUND. (Test: `returns all current sources without selecting`)

