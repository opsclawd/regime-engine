# Task Context: Task 11

Title: Verify the complete PostgreSQL evidence HTTP flow
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

- Create: `src/adapters/http/__tests__/evidence.e2e.pg.test.ts`
- Modify: `package.json` (`scripts.test:pg` only)

- [ ] **Step 1: Add a PG-gated route suite using the published fixture**

Build the real app with `DATABASE_URL`, `PG_SSL=false`, in-memory SQLite, and a test evidence token. Clean only test publisher/source rows after each case. Cover durable create; exact replay preserving receipt ID/time/bytes; changed-content conflict; stable validation details; all four scopes; publisher/source current fan-out order; exact-scope isolation; freshness boundary, stale and expired visibility; bounded history; opaque cursor traversal with an intervening newer insert; empty history; current not found; and a deliberately closed/unavailable PostgreSQL client mapped to `503`. Assert evidence rows change while `clmm_insights` does not.

Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/adapters/http/__tests__/evidence.e2e.pg.test.ts`

Expected before final wiring corrections: focused failures identify any response/repository mismatch; after implementation all cases pass.

- [ ] **Step 2: Add the focused suite to the existing PG script**

Append `src/adapters/http/__tests__/evidence.e2e.pg.test.ts` to `scripts.test:pg` without removing existing suites.

- [ ] **Step 3: Verify and commit**

Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/adapters/http/__tests__/evidence.e2e.pg.test.ts`

Run: `node -e 'const p=require("./package.json"); if(!p.scripts["test:pg"].includes("src/adapters/http/__tests__/evidence.e2e.pg.test.ts")) process.exit(1)'`

Expected: both commands exit zero.

Commit: `git add src/adapters/http/__tests__/evidence.e2e.pg.test.ts package.json && git commit -m "m59: cover evidence API with postgres"`

## Repository Targets

### Expected Files
- src/adapters/http/__tests__/evidence.e2e.pg.test.ts
- package.json

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/adapters/http/__tests__/evidence.e2e.pg.test.ts
node -e 'const p=require("./package.json"); if(!p.scripts["test:pg"].includes("src/adapters/http/__tests__/evidence.e2e.pg.test.ts")) process.exit(1)'
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **preserves durable replay and cursor semantics through HTTP**: The real route/use-case/repository stack preserves the first receipt on replay, rejects changed content, isolates all scopes, and traverses older pages without duplicates after a newer insert. (Test: `preserves durable replay and cursor semantics through HTTP`)

