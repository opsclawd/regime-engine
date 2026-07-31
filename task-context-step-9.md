# Task Context: Task 9

Title: Run and verify the position worker in the HTTP service
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

- Create: `src/workers/positionPolicyInsightSynthesizer.ts`
- Create: `src/workers/__tests__/positionPolicyInsightSynthesizer.test.ts`
- Modify: `src/composition/buildApp.ts`
- Create: `src/composition/__tests__/positionPolicyInsightRuntime.e2e.pg.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Exported API changes:** Allow `buildApp` to receive/internally expose lifecycle dependencies for tests and export `runPositionPolicyInsightSynthesizer` with an abortable dependency object. Normal `buildApp()` callers remain valid.

**Behavioral invariants / tests written first:**

- `starts one position worker only when both Postgres and SQLite dependencies are available`.
- `reconciles waiting and currently eligible unexpired position scopes before polling`.
- `continues polling after a cycle error and stops cleanly on Fastify close`.
- `does not start position synthesis in SQLite-only mode`.
- `restart reclaims an expired lease and persists exactly one canonical insight`.
- `evidence first and plan first both become visible through the current position insight endpoint`.
- `duplicate evidence creates no duplicate insight and a new plan creates a new insight`.
- `two positions sharing one intelligence correlation synthesize independently`.

- [ ] Write the worker lifecycle unit tests and a new focused Postgres/SQLite integration test. Keep the integration test below the oversized-test threshold by using table-driven arrival-order cases.
- [ ] Run `pnpm exec vitest run src/workers/__tests__/positionPolicyInsightSynthesizer.test.ts`; expect the missing runner failure. With Postgres available, run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/composition/__tests__/positionPolicyInsightRuntime.e2e.pg.test.ts`; expect missing lifecycle behavior.
- [ ] Implement an abortable poll loop that performs startup reconciliation, calls Task 8's cycle, logs and continues after cycle-level exceptions, and uses the existing policy worker timing configuration. Register it from `buildApp` against the same `RuntimeStoreContext`/`LEDGER_DB_PATH` as HTTP; abort and await it in `onClose`. Add `start:policy-synthesis` as an operational/local entry point using the same runner, not a second implementation.
- [ ] Document co-location, `LEDGER_DB_PATH` volume requirements, the internal replay call, queue metrics/status queries, the required deployment response handling for `freshEvidenceRequired`, and the fact that source-write replay/startup reconciliation repairs the unavoidable SQLite/Postgres dual-write gap.
- [ ] Re-run both targeted test commands and `pnpm exec eslint src/workers/positionPolicyInsightSynthesizer.ts src/workers/__tests__/positionPolicyInsightSynthesizer.test.ts src/composition/buildApp.ts src/composition/__tests__/positionPolicyInsightRuntime.e2e.pg.test.ts`; run `pnpm exec prettier --check package.json README.md`; expect success and the automatic typecheck gate.
- [ ] Commit the task files with `git commit -m "m79: run position synthesis with the api"`.

## Tests to add or update

- Add focused SQLite migration/read tests, Postgres queue schema/adapter tests, coordinator tests, internal endpoint tests, worker state-machine tests, and one compact end-to-end runtime test.
- Update existing synthesis/selection tests for five-minute filtering and exact structured codes.
- Update the small plan/evidence use-case tests for both created and idempotent wake-ups.
- Do not grow `src/adapters/http/__tests__/evidence.e2e.pg.test.ts`; the new endpoint gets dedicated test files.
- Every behavioral invariant above is an exact test case name written before implementation.

## Validation commands

Each task contains file-scoped Vitest/ESLint/Prettier commands. After all implementation tasks, the dedicated validate phase (not an implementation task) must run the repository quality gate exactly as required by `AGENTS.md`:

```bash
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build
pnpm run boundaries
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
```

For migration validation, start the repository test database using its checked-in configuration before the Postgres commands:

```bash
docker compose -f docker-compose.test.yml up -d
pnpm run db:migrate
```

## Risk areas

- SQLite and Postgres cannot commit atomically. The design deliberately uses idempotent source replay, waiting rows, startup reconciliation, and the internal eligible-scope trigger as recovery paths.
- SQLite schema upgrades are irreversible in place; malformed legacy canonical JSON must abort startup rather than silently leaving unindexed rows.
- Horizontal HTTP scaling is unsafe unless every replica mounts the same SQLite ledger and SQLite locking remains acceptable. Deployment must remain single-writer until plan storage moves.
- Lease duration must exceed a normal synthesis cycle; a stolen lease is contained by owner-checked terminal mutations and final insight idempotency.
- Selection can change as evidence expires. `expectedSelectionHash` prevents a queue identity from synthesizing a different selection.
- A plan without `walletId` cannot satisfy exact position evidence identity and is intentionally not enqueued.
- Drizzle generated metadata is easy to drift; SQL, TypeScript schema, snapshot, and journal must be generated and committed together.

## Stop conditions

- Abort if production cannot guarantee that the HTTP process and position worker use the same persistent `LEDGER_DB_PATH`; do not fall back to cross-container local SQLite access.
- Abort the SQLite migration if any existing `request_json` cannot be parsed into a position identity; do not populate invented/null identity values for legacy rows.
- Abort if the checked-in evidence contract does not provide wallet, whirlpool, position, `asOf`, and expiration values needed for exact compatibility.
- Abort if adding a queue port method would leave any adapter or fake implementation uncompilable in the same task; keep port and every required implementation together.
- Abort deployment if migration tests, lease-recovery tests, source-replay tests, or the existing current-insight read contract fail.
- Abort deployment backfill if it reports `freshEvidenceRequired` and the operator/companion deployment has no configured way to initiate and verify the upstream intelligence run; this repository does not invent an undocumented cross-service endpoint.
- Abort rather than add message-string classification or inline synthesis to the internal POST endpoint.

## Assumptions documented

- `design.md` selects co-location; this plan interprets it as an in-process worker owned by the HTTP Fastify lifecycle, with a standalone script only for controlled operations against the same mounted ledger.
- The temporal rule is inclusive `plan.asOfUnixMs ± 300_000ms` against evidence bundle `asOf`; exact wallet/position/pool equality is additionally required.
- Existing evidence or plans with no counterpart are durable waiting work, not errors. Expired evidence becomes `POSITION_STALE` when reconciliation can establish that it cannot become eligible.
- Older ready requests are retained for audit and become `superseded` when a newer plan or selection wins; rows are not destructively deleted.
- "Trigger a fresh intelligence run" is represented by a durable `waiting_for_evidence` request plus `freshEvidenceRequired: true` in the authenticated deployment response. The companion deployment must consume that signal because the issue supplies no authorized intelligence-service endpoint for Regime Engine to call.

## Repository Targets

### Expected Files
- src/workers/positionPolicyInsightSynthesizer.ts
- src/workers/__tests__/positionPolicyInsightSynthesizer.test.ts
- src/composition/buildApp.ts
- src/composition/__tests__/positionPolicyInsightRuntime.e2e.pg.test.ts
- package.json
- README.md

### Reference Files
- src/workers/policyInsightSynthesisWorker.ts
- src/composition/buildStoreContext.ts
- railway.toml
- scripts/start.sh

## Validation Commands

```bash
pnpm exec vitest run src/workers/__tests__/positionPolicyInsightSynthesizer.test.ts
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/composition/__tests__/positionPolicyInsightRuntime.e2e.pg.test.ts
pnpm exec eslint src/workers/positionPolicyInsightSynthesizer.ts src/workers/__tests__/positionPolicyInsightSynthesizer.test.ts src/composition/buildApp.ts src/composition/__tests__/positionPolicyInsightRuntime.e2e.pg.test.ts
pnpm exec prettier --check package.json README.md
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **co-located lifecycle**: Exactly one position worker shares the HTTP store context and stops on Fastify close. (Test: `starts one position worker only when both Postgres and SQLite dependencies are available`)
- **restart recovery idempotency**: An expired lease is reclaimed after restart and produces exactly one canonical insight. (Test: `restart reclaims an expired lease and persists exactly one canonical insight`)
- **both arrival orders**: Evidence-first and plan-first sequences both become visible through the current position insight endpoint. (Test: `evidence first and plan first both become visible through the current position insight endpoint`)
- **identity behavior end to end**: Duplicate evidence deduplicates while a changed plan produces a new insight. (Test: `duplicate evidence creates no duplicate insight and a new plan creates a new insight`)

