# Task Context: Task 13

Title: Fail fast when the evidence table is missing
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

- Modify: `src/ledger/pg/db.ts`
- Modify: `src/server.ts`
- Modify: `src/__tests__/pgStartup.test.ts` (`PostgreSQL table verification` area only)

- [ ] **Step 1: Write the failing startup table check**

Import a not-yet-existing `verifyEvidenceBundlesTable`, run it against the migrated PG test database, and name the case `resolves when evidence_bundles exists in regime_engine schema`. Use the same connection lifecycle as existing startup tests.

Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/__tests__/pgStartup.test.ts -t "evidence_bundles"`

Expected: FAIL because the verifier is missing.

- [ ] **Step 2: Add and invoke the verifier**

Implement:

```ts
export const verifyEvidenceBundlesTable = async (db: Db): Promise<void> => {
  const result = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'regime_engine' AND tablename = 'evidence_bundles'
  `);
  if (result.length === 0) {
    throw new Error("FATAL: evidence_bundles table not found in regime_engine schema — run migrations first");
  }
};
```

Import it in `src/server.ts` and call it after schema verification alongside the other required table checks, before `buildApp()`.

- [ ] **Step 3: Verify and commit**

Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/__tests__/pgStartup.test.ts -t "evidence_bundles"`

Expected: PASS.

Commit: `git add src/ledger/pg/db.ts src/server.ts src/__tests__/pgStartup.test.ts && git commit -m "m59: verify evidence table at startup"`

**Tests to add or update**

- Update timestamp semantic and PG append tests for unequal `asOf`/`createdAt`.
- Add adapter tests that distinguish transient PostgreSQL failures from data corruption and invariant failures.
- Add one focused unit suite per application use case.
- Add strict scope/query/cursor codec unit tests.
- Add one focused handler suite per endpoint.
- Add a no-PostgreSQL composition/route-isolation/body-limit suite.
- Add a real PostgreSQL HTTP E2E suite covering replay state, scope isolation, lifecycle visibility, and pagination under intervening inserts.
- Add an evidence-only OpenAPI contract suite.
- Update PostgreSQL startup verification tests.

**Dedicated validation phase (runs after all implementation tasks; not an implementation task)**

Run these exact repository gates after the task commits are complete:

```text
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build
pnpm run test:pg
pnpm run boundaries
pnpm run contract:evidence:check
```

Expected: every command exits zero; `pnpm run test:pg` requires the documented local test PostgreSQL at `postgres://test:test@localhost:5432/regime_engine_test` with migrations applied.

**Risk areas**

- The current repository validator rejects the correct positive assembly delay; failing to land Task 1 first converts valid requests into misleading persistence errors.
- Broad PostgreSQL error wrapping could hide corrupt stored JSON or impossible replay states as `503`; classification must remain allowlisted and tested.
- Fastify may represent repeated query parameters as arrays; parsers must handle `unknown`, not cast to a string record.
- A current response containing multiple items can be mistaken for selected evidence; plural naming, deterministic order, and OpenAPI wording must remain explicit.
- Unauthenticated reads expose complete provenance and position identifiers. This is intentional for this issue but deployment network policy must be reviewed separately.
- Large valid bundles consume parse memory before handler auth; the route-level 4 MiB limit and infrastructure rate limiting are the mitigation.
- Cursor decoding that accepts extra fields, unsafe integers, or noncanonical base64url weakens pagination determinism.
- Evidence and legacy insight routes coexist; shared tokens, handlers, stores, or path aliases would violate the authority boundary.
- Tests that mutate `process.env` or shared PostgreSQL rows can leak across cases; restore env and delete only uniquely-prefixed evidence rows.

**Stop conditions**

- Abort if issue #58's schema, repository port, migration, or `evidence_bundles` table is absent or materially differs from the signatures assumed here; re-plan against the actual prerequisite rather than recreating it.
- Abort if correcting `asOf <= createdAt` would require changing the normative JSON Schema or database constraint; that indicates prerequisite contract drift needing separate approval.
- Abort if the 4 MiB limit rejects any checked-in valid evidence fixture; measure fixture size and revisit the transport limit instead of silently truncating or weakening validation.
- Abort if adding evidence members to dependency interfaces cannot be completed with all composition and route consumers in the same task; do not leave a port/interface-only commit that fails workspace typecheck.
- Abort if PostgreSQL failures cannot be classified without relying on unstable message matching alone; preserve `500` for unknowns and document the missing stable driver signal.
- Abort if OpenAPI cannot reference the checked-in evidence schema without transforming or duplicating it; do not hand-maintain a divergent body schema.
- Abort before any migration/schema mutation, legacy insight removal, GET authentication, external network call, or evidence-selection behavior, because each is outside issue #59.

## Repository Targets

### Expected Files
- src/ledger/pg/db.ts
- src/server.ts
- src/__tests__/pgStartup.test.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/__tests__/pgStartup.test.ts -t "evidence_bundles"
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **fails startup when the evidence table is absent**: Configured PostgreSQL startup succeeds only when regime_engine.evidence_bundles exists and otherwise fails before the Fastify app starts. (Test: `resolves when evidence_bundles exists in regime_engine schema`)

