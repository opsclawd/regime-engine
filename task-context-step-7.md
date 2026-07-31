# Task Context: Task 7

Title: Add the protected internal replay and backfill endpoint
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

- Create: `src/adapters/http/handlers/positionSynthesisRequest.ts`
- Create: `src/adapters/http/handlers/__tests__/positionSynthesisRequest.test.ts`
- Modify: `src/adapters/http/routes.ts`
- Modify: `src/adapters/http/openapi.ts`
- Create: `src/adapters/http/__tests__/positionSynthesisRequest.openapi.contract.test.ts`
- Create: `src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`
- Modify: `.env.example`

**Exported API changes:** Extend `HttpRouteDependencies` with the nullable request use case and register `POST /v1/internal/insights/sol-usdc/synthesis-requests`.

**Behavioral invariants / tests written first:**

- `rejects a missing or incorrect X-Policy-Synthesis-Token before store access`.
- `accepts one complete position scope and returns 202 with its request id and queue status`.
- `accepts mode eligible and returns 202 with deterministic request ids for every unexpired eligible position scope`.
- `reports plan scopes without eligible evidence as freshEvidenceRequired for deployment automation`.
- `returns 400 for partial scope identity and 503 when Postgres synthesis dependencies are absent`.
- `documents authentication request modes 202 400 401 500 and 503 responses`.

- [ ] Write focused handler, route e2e, and OpenAPI contract tests; do not add cases to the existing 1,038-line evidence e2e file.
- [ ] Run `pnpm exec vitest run src/adapters/http/handlers/__tests__/positionSynthesisRequest.test.ts src/adapters/http/__tests__/positionSynthesisRequest.openapi.contract.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`; expect missing route/handler failures.
- [ ] Implement shared-secret authentication through `requireSharedSecret(headers, "X-Policy-Synthesis-Token", "POLICY_SYNTHESIS_INTERNAL_TOKEN")`. Validate either `{mode:"eligible"}` or `{mode:"scope", walletAddress, whirlpoolAddress, positionId}`; invoke reconciliation only, never synthesis; return `202` with `{schemaVersion:"1.0", requests:[{requestId,status,freshEvidenceRequired}]}`. Deployment automation treats any `freshEvidenceRequired: true` item as a required upstream intelligence-run trigger and must not mark backfill complete until fresh evidence is ingested.
- [ ] Add the route/OpenAPI operation and document `POLICY_SYNTHESIS_INTERNAL_TOKEN` in `.env.example`.
- [ ] Re-run the targeted Vitest command and `pnpm exec eslint src/adapters/http/handlers/positionSynthesisRequest.ts src/adapters/http/handlers/__tests__/positionSynthesisRequest.test.ts src/adapters/http/routes.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/positionSynthesisRequest.openapi.contract.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`; run `pnpm exec prettier --check .env.example`; expect success and the automatic typecheck gate.
- [ ] Commit the task files with `git commit -m "m79: expose position synthesis replay trigger"`.

## Repository Targets

### Expected Files
- src/adapters/http/handlers/positionSynthesisRequest.ts
- src/adapters/http/handlers/__tests__/positionSynthesisRequest.test.ts
- src/adapters/http/routes.ts
- src/adapters/http/openapi.ts
- src/adapters/http/__tests__/positionSynthesisRequest.openapi.contract.test.ts
- src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts
- .env.example

### Reference Files
- src/adapters/http/auth.ts
- src/adapters/http/handlers/evidenceIngest.ts

## Validation Commands

```bash
pnpm exec vitest run src/adapters/http/handlers/__tests__/positionSynthesisRequest.test.ts src/adapters/http/__tests__/positionSynthesisRequest.openapi.contract.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts
pnpm exec eslint src/adapters/http/handlers/positionSynthesisRequest.ts src/adapters/http/handlers/__tests__/positionSynthesisRequest.test.ts src/adapters/http/routes.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/positionSynthesisRequest.openapi.contract.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts
pnpm exec prettier --check .env.example
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **auth before access**: Missing or incorrect shared secret is rejected before any queue or ledger call. (Test: `rejects a missing or incorrect X-Policy-Synthesis-Token before store access`)
- **asynchronous trigger**: A valid scope request reconciles work and returns 202 without invoking synthesis inline. (Test: `accepts one complete position scope and returns 202 with its request id and queue status`)
- **eligible backfill**: Eligible mode returns deterministic request IDs for all currently unexpired position scopes. (Test: `accepts mode eligible and returns 202 with deterministic request ids for every unexpired eligible position scope`)
- **fresh evidence signal**: Plan scopes without compatible evidence are durable waiting work and explicitly require an upstream intelligence refresh. (Test: `reports plan scopes without eligible evidence as freshEvidenceRequired for deployment automation`)

