# Task Context: Task 10

Title: Wire all evidence dependencies and isolated routes atomically
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

- Modify: `src/composition/buildApplication.ts`
- Modify: `src/adapters/http/routes.ts`
- Create: `src/composition/__tests__/evidenceRoutes.e2e.test.ts`

- [ ] **Step 1: Write failing composition/route tests**

With no `DATABASE_URL`, assert authenticated POST and both GETs return `503 EVIDENCE_STORE_UNAVAILABLE`; assert unauthenticated POST returns `401` before `503`; assert evidence requests do not call or write legacy insight state; assert the legacy insight routes remain registered. Send a JSON body just over 4 MiB with valid auth and assert Fastify returns `413` before the use case.

Run: `pnpm vitest run src/composition/__tests__/evidenceRoutes.e2e.test.ts`

Expected: FAIL with evidence routes returning `404`.

- [ ] **Step 2: Extend dependency interfaces and their implementation in one typecheck-safe change**

Add nullable `ingestEvidenceBundle`, `getCurrentEvidence`, and `getEvidenceHistory` properties to both `ApplicationDependencies` and `HttpRouteDependencies`. In `buildApplication`, create exactly one `createPostgresEvidenceBundleRepository(ctx.pg)` when `ctx.pg` exists, then create all three use cases around that repository and the existing clock; otherwise assign all three `null`. Return every new property in the existing dependency object. This task deliberately combines the required-member interface change with all composition/route consumers so the automatic workspace typecheck never sees a port-only state.

- [ ] **Step 3: Register the three distinct routes**

Add exactly:

```ts
app.post("/v1/evidence/sol-usdc", { bodyLimit: EVIDENCE_BODY_LIMIT_BYTES }, createEvidenceIngestHandler(deps.ingestEvidenceBundle));
app.get("/v1/evidence/sol-usdc/current", createEvidenceCurrentHandler(deps.getCurrentEvidence));
app.get("/v1/evidence/sol-usdc/history", createEvidenceHistoryHandler(deps.getEvidenceHistory));
```

Do not alter, alias, redirect, or reuse the three `/v1/insights/sol-usdc` registrations.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run src/composition/__tests__/evidenceRoutes.e2e.test.ts`

Expected: PASS, including `413`, auth-before-store, and route-isolation cases.

Commit: `git add src/composition/buildApplication.ts src/adapters/http/routes.ts src/composition/__tests__/evidenceRoutes.e2e.test.ts && git commit -m "m59: wire isolated evidence routes"`

## Repository Targets

### Expected Files
- src/composition/buildApplication.ts
- src/adapters/http/routes.ts
- src/composition/__tests__/evidenceRoutes.e2e.test.ts

## Validation Commands

```bash
pnpm vitest run src/composition/__tests__/evidenceRoutes.e2e.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **never routes evidence through final-policy insights**: Evidence has three distinct paths, use cases, token, and repository wiring; legacy insight routes remain separately registered and untouched. (Test: `never routes evidence through final-policy insights`)
- **rejects evidence bodies larger than four mebibytes**: The POST route returns Fastify 413 before evidence validation or persistence when the body exceeds 4 MiB. (Test: `rejects evidence bodies larger than four mebibytes`)

