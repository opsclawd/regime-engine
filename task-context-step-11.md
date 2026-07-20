# Task Context: Task 11

Title: Cut history over and document the trusted synthesis boundary
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

- Modify: `src/adapters/http/handlers/insightsHistory.ts`
- Modify: `src/adapters/http/routes.ts`
- Modify: `src/adapters/http/openapi.ts`
- Modify: `src/composition/buildApplication.ts`
- Modify: `src/server.ts`
- Create: `src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`
- Modify: `package.json`
- Modify: `documentation.md`

**Invariants implemented first:**

- `history endpoint uses the same tuple order as current`
- `history cursor returns no duplicates or gaps for equal timestamps`
- `history endpoint returns canonical rows only`

- [ ] **Step 1: Write the new focused history endpoint tests**

  Create a separate file rather than modifying the 15-case legacy PostgreSQL test. Cover empty history, exact #63 envelope, pair/position scope, bounded limits, invalid/tampered cursor, multi-page equal-timestamp traversal, changed inputs as separate history, 503 store unavailable, and proof that legacy rows are ignored.

- [ ] **Step 2: Confirm RED**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`

  Expected: FAIL because history still reads legacy storage and uses offset-like legacy semantics.

- [ ] **Step 3: Replace the history dependency and OpenAPI operation**

  Route `GET /v1/insights/sol-usdc/history` to `GetPolicyInsightHistoryUseCase | null`, parse/encode the #63-approved cursor, and return only the #63 history envelope. Update only the history OpenAPI operation; leave legacy POST explicitly marked as legacy/pending #62. Update the composition root in `src/composition/buildApplication.ts` and `src/server.ts` to provide `getPolicyInsightHistory` to `HttpRouteDependencies` so that the dependencies align, avoiding any breaking type errors.

- [ ] **Step 4: Register focused PostgreSQL coverage and document operations**

  Add the three policy repository tests, migration test, and two endpoint tests to `test:pg`. In `documentation.md`, document the `sol-usdc-policy.v1` precedence, exact-scope selection, one-clock rule, advisory-only boundary, append-only/idempotent storage, trusted internal command, no scheduler/public synthesis endpoint, legacy POST isolation, and the requirement that deployment must have an actual trusted caller before relying on current reads.

- [ ] **Step 5: Verify history and documentation changes**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`

  Run: `pnpm exec eslint src/adapters/http/handlers/insightsHistory.ts src/adapters/http/routes.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`

  Run: `pnpm exec prettier --check package.json documentation.md`

  Expected: cursor tests pass, legacy rows remain invisible, and documentation/package formatting is clean.

- [ ] **Step 6: Commit the task**

  Run: `git add src/adapters/http/handlers/insightsHistory.ts src/adapters/http/routes.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts package.json documentation.md src/composition/buildApplication.ts src/server.ts && git commit -m "m61: serve canonical policy insight history"`

### Tests to add or update

- Pure ruleset validation and immutable configuration tests.
- Pure precedence/lock tests with explicit lower/upper breach contradiction cases.
- Evidence refinement, degraded-mode, S/R binding, reasoning-bound, and canonical determinism tests.
- Application one-clock, linkage rejection, canonical hashing, replay, changed-input, validation, and persistence-failure tests.
- PostgreSQL schema/migration, atomic command, current ordering, and stable cursor-history tests.
- Composition capability/unavailable-mode and startup schema checks.
- Focused current/history HTTP PostgreSQL suites using #63 fixtures; do not add more cases to the existing 15-case legacy test file.
- Existing regime/selection use-case tests updated only for the explicit-instant overload.

### Validation commands

The implementation loop automatically runs `pnpm -r typecheck` after every task. Each task above also has a focused, path-scoped RED/GREEN command. After all implementation tasks complete, the dedicated validate phase must run:

```bash
pnpm run typecheck
pnpm run test
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
pnpm run lint
pnpm run boundaries
pnpm run format
pnpm run build
```

Expected: every command exits 0; PostgreSQL validation runs against a database migrated through `drizzle/0006_create_policy_insights.sql`.

### Risk areas

- **#63 dependency drift:** exact enum values, units, optional levels, cursor, identity, and freshness wrappers can change reducer/storage/HTTP mappings. Never patch around the contract.
- **Cross-store linkage:** position/plan truth is supplied from outside PostgreSQL; only verified immutable hashes can make the audit record honest.
- **Time-dependent idempotency:** hashes must retain semantic freshness class/boundaries while excluding presentation-only ages, or retries will either duplicate rows or reuse stale policy.
- **Concurrent insert races:** the unique input tuple and select-winner path must be in one adapter transaction.
- **State-machine monotonicity:** lower stages must not accidentally reset higher-stage locks when constructing the final #63 object.
- **Legacy cutover:** POST remains legacy while GET current/history become canonical; dependency wiring must keep those paths separate.
- **Reasoning leakage:** arbitrary publisher prose must not enter action rules, metrics, machine codes, or unbounded output.
- **S/R unit safety:** contextual prose has no structured numeric price; only a full allowlisted feature binding may emit a level.
- **No production trigger:** a composed command is not a schedule. Deployment must explicitly confirm a trusted caller before treating the current endpoint as populated.
- **Migration side effect:** creating `policy_insights` is persistent database state. Validate constraints/indexes in a disposable database before applying in production.

### Stop conditions

Abort implementation instead of continuing when any of these occurs:

- #63 is not merged, or its canonical type/parser/schema/fixtures/identity/cursor/freshness semantics are incomplete.
- #63 cannot represent advisory pause/stand-down for hard-stale market or supplied stale-position state with a valid expiry.
- #63 requires non-empty numerical support/resistance levels when no structured price-valued evidence exists; request a versioned upstream contract/evidence change instead of parsing prose.
- The supplied position/plan cannot be cryptographically linked, `planHash` does not verify, scope/pair/position identities disagree, or the selection instant differs from the captured synthesis instant.
- Implementing the trusted trigger would require a new public endpoint/scheduler or cross-repository change not authorized by this issue.
- The migration cannot enforce append-only identity/input uniqueness and timestamp/hash checks on the supported PostgreSQL version.
- A task would require modifying #60 selection semantics, #63 wire semantics, legacy row migration/removal, or execution authority.
- Existing unrelated worktree changes overlap a required file and cannot be preserved safely.

### Definition of done

- Every named invariant exists as a passing test written before its implementation.
- One canonical input produces one stored #63-valid insight under retries and concurrency.
- Every degraded scenario produces an explicit deterministic policy or an explicit pre-persistence error allowed by #63.
- Current/history return only canonical persisted rows with stable tuple ordering and exact #63 shapes.
- No transaction/execution field, external source read, LLM decision, or legacy synthesized write is introduced.
- All focused task checks and the dedicated validation phase pass.

## Repository Targets

### Expected Files
- src/adapters/http/handlers/insightsHistory.ts
- src/adapters/http/routes.ts
- src/adapters/http/openapi.ts
- src/composition/buildApplication.ts
- src/server.ts
- src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts
- package.json
- documentation.md

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts
pnpm exec eslint src/adapters/http/handlers/insightsHistory.ts src/adapters/http/routes.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts
pnpm exec prettier --check package.json documentation.md
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **history/current order agreement**: History and current both order by generated timestamp descending and row ID descending. (Test: `history endpoint uses the same tuple order as current`)
- **gap-free endpoint cursor**: Cursor traversal across equal timestamps returns every row exactly once. (Test: `history cursor returns no duplicates or gaps for equal timestamps`)
- **canonical endpoint history**: The endpoint returns only policy_insights rows and never merges legacy external records. (Test: `history endpoint returns canonical rows only`)

