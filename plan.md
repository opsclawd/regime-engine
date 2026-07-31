<!-- plan-review-required -->

# Durable Position-Scoped PolicyInsight Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist, reconcile, lease, and process position-scoped PolicyInsight synthesis requests so matching position evidence and plans produce one canonical insight for each unique evidence selection, plan, and ruleset combination.

**Architecture:** Keep plans in the existing SQLite ledger and position synthesis requests/evidence/insights in Postgres. The HTTP process owns the position worker so it always opens the same `LEDGER_DB_PATH`; event hooks on both evidence ingestion and plan persistence reconcile a per-position waiting request into a uniquely keyed pending request. A leased Postgres queue provides crash recovery, while the existing canonical PolicyInsight repository remains the final idempotency boundary.

**Tech Stack:** TypeScript, Node 22 `node:sqlite`, Fastify, Drizzle/Postgres, Vitest, canonical JSON/SHA-256.

---

## Goal

Deliver all issue acceptance criteria for position scopes: durable wake-ups from both arrival orders, exact plan recovery and hash verification, five-minute evidence/plan compatibility, independent positions, structured error classification, lease recovery, authenticated replay/backfill, and visibility through the existing current-insight endpoint.

## Non-goals

- Do not change pair/whirlpool synthesis behavior or replace `policy_insight_synthesis_cursor` from issue #78.
- Do not change `clmm-v2`, on-chain execution, plan action policy, or the PolicyInsight wire schema.
- Do not move or mirror the SQLite plan ledger into Postgres.
- Do not claim a SQLite/Postgres atomic transaction; replay hooks and startup reconciliation close the cross-store wake-up gap.
- Do not change the 60-second plan-generation observation guard or the policy ruleset's 24-hour position maximum age.

## Behavioral model and invariants

The queue states are `waiting_for_plan`, `waiting_for_evidence`, `pending`, `processing`, `completed`, `failed`, and `superseded`.

- Evidence-only input creates or refreshes `waiting_for_plan`; a compatible plan promotes it to `pending` without losing the evidence wake-up.
- Plan-only input creates or refreshes `waiting_for_evidence`; compatible evidence promotes it to `pending`.
- A ready identity is exactly `(scopeKey, selectionHash, planHash, rulesetVersion)` and is unique. Replays return the existing request ID.
- Claims change `pending`, retry-due, or lease-expired `processing` rows to `processing` under `FOR UPDATE SKIP LOCKED`; an unexpired lease cannot be stolen.
- Completion/failure/retry/supersession updates require the same request ID and lease owner. A stale owner cannot finalize work.
- A request whose `planHash` is no longer the latest eligible plan becomes `superseded`; a newer plan gets its own ready identity.
- Evidence is compatible only when wallet, position, and pool match exactly and its `asOf` is within an inclusive five-minute window around `plan.asOfUnixMs`.
- Evidence that expires before a plan arrives permanently fails its waiting request with `POSITION_STALE`; absence of evidence remains `waiting_for_evidence`.
- A selected-evidence hash change between enqueue and execution supersedes the old request instead of synthesizing under the wrong identity.
- Retryable store/market failures return to `pending` with bounded backoff; validation failures are permanent; exhausted retries become `failed`.
- `policy_insights.insertOrGet` remains the final duplicate-prevention boundary after queue idempotency.

## Affected files

Paths are repository-relative and are the complete planned edit surface.

- SQLite plan storage/read path: `src/ledger/schema.sql`, `src/ledger/store.ts`, `src/ledger/writer.ts`, `src/application/ports/planLedgerPort.ts`, `src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts`, `src/ledger/__tests__/planLedgerPositionMigration.test.ts`, `src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts`.
- Temporal selection and structured errors: `src/application/errors/policyInsightErrors.ts`, `src/application/ports/evidenceBundleRepositoryPort.ts`, `src/adapters/postgres/postgresEvidenceBundleRepository.ts`, `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts`, `src/application/use-cases/policyInsightFingerprints.ts`, `src/application/use-cases/synthesizePolicyInsightUseCase.ts`, `src/application/use-cases/getCurrentPolicyInsightUseCase.ts`, `src/application/use-cases/getPolicyInsightHistoryUseCase.ts`, `src/adapters/postgres/postgresPolicyInsightRepository.ts`, `src/adapters/http/handlers/insightsCurrent.ts`, `src/adapters/http/handlers/insightsHistory.ts`, `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`, `src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`, `src/workers/policyInsight/runSynthesisCycle.ts`, `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`, `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`, `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`, `src/application/errors/__tests__/policyInsightErrors.test.ts`.
- Postgres queue schema: `drizzle/0010_create_policy_insight_synthesis_requests.sql`, `drizzle/meta/0010_snapshot.json`, `drizzle/meta/_journal.json`, `src/ledger/pg/schema/policyInsightSynthesisRequests.ts`, `src/ledger/pg/schema/index.ts`, `src/ledger/pg/db.ts`, `src/ledger/pg/__tests__/policyInsightSynthesisRequestsMigration.test.ts`, `src/ledger/pg/schema/__tests__/policyInsightSynthesisRequests.shape.test.ts`, `src/__tests__/pgStartup.test.ts`, `src/server.ts`.
- Queue and coordinator: `src/application/ports/positionPolicyInsightSynthesisQueuePort.ts`, `src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts`, `src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts`, `src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts`, `src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`.
- Event wake-ups: `src/application/use-cases/ingestEvidenceBundleUseCase.ts`, `src/application/use-cases/generatePlanUseCase.ts`, `src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts`, `src/application/use-cases/__tests__/generatePlanUseCase.test.ts`, `src/adapters/http/handlers/evidenceIngest.ts`, `src/adapters/http/handlers/plan.ts`, `src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts`, `src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts`, `src/composition/buildApplication.ts`, `src/composition/__tests__/positionPolicyInsightWiring.test.ts`.
- Internal endpoint: `src/adapters/http/handlers/positionSynthesisRequest.ts`, `src/adapters/http/handlers/__tests__/positionSynthesisRequest.test.ts`, `src/adapters/http/routes.ts`, `src/adapters/http/openapi.ts`, `src/adapters/http/__tests__/positionSynthesisRequest.openapi.contract.test.ts`, `src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`, `.env.example`.
- Worker/runtime: `src/workers/policyInsight/runPositionSynthesisCycle.ts`, `src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts`, `src/workers/positionPolicyInsightSynthesizer.ts`, `src/workers/__tests__/positionPolicyInsightSynthesizer.test.ts`, `src/composition/buildApp.ts`, `src/composition/__tests__/positionPolicyInsightRuntime.e2e.pg.test.ts`, `package.json`, `README.md`.

## Task 1: Add the indexed SQLite position-plan read model

**Files:**

- Modify: `src/ledger/schema.sql`
- Modify: `src/ledger/store.ts`
- Modify: `src/ledger/writer.ts`
- Modify: `src/application/ports/planLedgerPort.ts`
- Create: `src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts`
- Create: `src/ledger/__tests__/planLedgerPositionMigration.test.ts`
- Create: `src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts`

**Exported API changes:** Add `StoredPositionPlan` and `PlanLedgerReadPort`, with `getLatestPositionPlan(scope)`, `getPositionPlanByHash(scope, planHash)`, and `listLatestPositionPlans()`. Keep `PlanLedgerWritePort.writePlan` unchanged.

**Behavioral invariants / tests written first:**

- `migrates an existing plan ledger and backfills position lookup columns from canonical request JSON`: an old database gains `position_id`, `wallet_id`, and `pool_address` without losing rows.
- `enables WAL for a file-backed ledger used by the HTTP process and worker`: a file ledger reports `journal_mode=wal`; `:memory:` remains supported.
- `writes denormalized position identity with the canonical request and plan in one transaction`: either both ledger rows exist or neither does.
- `returns the exact latest request and response for a matching wallet position and pool`: ordering is `plans.as_of_unix_ms DESC, plans.id DESC` and no JSON scan is used.
- `returns the exact historical plan selected by plan hash`: the adapter does not reconstruct or substitute fields.
- `lists one latest wallet identified plan per position and pool for deployment reconciliation`: plan-only scopes are discoverable even when Postgres has no evidence.
- `does not match a missing wallet or a different position or pool`: exact identity is mandatory.

- [ ] Add failing migration and adapter tests. Construct a legacy SQLite file with the old table shape, reopen it through `createLedgerStore`, and assert the backfill and query plan via `EXPLAIN QUERY PLAN` uses `idx_plan_requests_position_lookup`.
- [ ] Run `pnpm exec vitest run src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts`; expect failures for absent columns/read adapter.
- [ ] Change the fresh-install `plan_requests` definition to include the three lookup columns and an index on `(position_id, wallet_id, pool_address, as_of_unix_ms DESC, id DESC)`. In `createLedgerStore`, run a transactionally guarded compatibility migration that inspects `PRAGMA table_info(plan_requests)`, adds missing columns, parses each canonical `request_json`, backfills identities, then creates the index. Set `PRAGMA journal_mode=WAL` for file databases before normal traffic.
- [ ] Extend the writer insert to store `planRequest.position.positionId`, `planRequest.position.walletId ?? null`, and `planRequest.market.poolAddress`. Implement both read methods by joining `plan_requests` and `plans` on `plan_id`, parsing the stored JSON, and returning the exact pair:

```ts
export interface StoredPositionPlan {
  readonly planRequest: PlanRequest;
  readonly planResponse: PlanResponse;
}

export interface PlanLedgerReadPort {
  getLatestPositionPlan(scope: PositionPlanScope): Promise<StoredPositionPlan | null>;
  getPositionPlanByHash(
    scope: PositionPlanScope,
    planHash: string
  ): Promise<StoredPositionPlan | null>;
  listLatestPositionPlans(): Promise<readonly StoredPositionPlan[]>;
}
```

- [ ] Re-run the targeted Vitest command and `pnpm exec eslint src/ledger/store.ts src/ledger/writer.ts src/application/ports/planLedgerPort.ts src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts`; expect all checks to pass. The automatic implementation gate then runs `pnpm -r typecheck`.
- [ ] Commit with `git add src/ledger/schema.sql src/ledger/store.ts src/ledger/writer.ts src/application/ports/planLedgerPort.ts src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts src/ledger/__tests__/planLedgerPositionMigration.test.ts src/adapters/sqlite/__tests__/sqlitePlanLedgerReadAdapter.test.ts && git commit -m "m79: index and read position plans"`.

## Task 2: Enforce temporal compatibility and structured synthesis errors

**Files:**

- Modify: `src/application/errors/policyInsightErrors.ts`
- Modify: `src/application/ports/evidenceBundleRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresEvidenceBundleRepository.ts`
- Modify: `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts`
- Modify: `src/application/use-cases/policyInsightFingerprints.ts`
- Modify: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/getCurrentPolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/getPolicyInsightHistoryUseCase.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Modify: `src/adapters/http/handlers/insightsCurrent.ts`
- Modify: `src/adapters/http/handlers/insightsHistory.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`
- Modify: `src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`
- Modify: `src/workers/policyInsight/runSynthesisCycle.ts`
- Modify: `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`
- Modify: `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`
- Create: `src/application/errors/__tests__/policyInsightErrors.test.ts`

**Exported API changes:** Add `PolicyInsightErrorCode`; make both PolicyInsight error classes expose a required `errorCode`; add optional `fromAsOfUnixMs`/`toAsOfUnixMs` filters to `EvidenceBundleRepositoryPort.getLatest` and `SelectEvidenceForSynthesisUseCase`; add optional `expectedSelectionHash` to `SynthesizePolicyInsightInput`. The Postgres evidence adapter is updated in this same task as its port. Update error class constructor call sites in `insightsCurrent.ts`, `insightsHistory.ts`, `postgresPolicyInsightRepository.command.test.ts`, `getPolicyInsightHistoryUseCase.test.ts`, and `runSynthesisCycle.ts`.

**Behavioral invariants / tests written first:**

- `selects position evidence at the inclusive five minute plan window boundaries`.
- `excludes position evidence one millisecond outside the plan window`.
- `rejects position wallet position and pool mismatches with structured scope codes`.
- `rejects stale positions and invalid plan hashes with POSITION_STALE and PLAN_HASH_INVALID`.
- `rejects a changed selected evidence set with EVIDENCE_SELECTION_SUPERSEDED`.
- `classifies market evidence and policy persistence failures without message matching`.
- `preserves structured codes through Error cause chains and repository adapters`.

- [ ] Write the named tests first, including exact assertions on `.errorCode`, inclusive SQL bounds, and the mismatch between `expectedSelectionHash` and the computed selection hash.
- [ ] Run `pnpm exec vitest run src/application/errors/__tests__/policyInsightErrors.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`; expect the new assertions to fail.
- [ ] Define the closed union below and update every constructor call in the files listed for this task; messages remain sanitized human context and are never used for classification:

```ts
export type PolicyInsightErrorCode =
  | "POSITION_PLAN_MISSING"
  | "POSITION_STALE"
  | "PLAN_HASH_INVALID"
  | "POSITION_SCOPE_MISMATCH"
  | "POOL_SCOPE_MISMATCH"
  | "EVIDENCE_SELECTION_SUPERSEDED"
  | "MARKET_DATA_UNAVAILABLE"
  | "EVIDENCE_STORE_UNAVAILABLE"
  | "POLICY_STORE_UNAVAILABLE"
  | "OUTPUT_SCHEMA_INVALID"
  | "QUERY_INVALID"
  | "EXHAUSTED_RETRIES";
```

- [ ] Pass the optional evidence `as_of_unix_ms` bounds through the selection use case and Postgres adapter. For a position plan, call selection with `plan.asOfUnixMs - 300_000` and `plan.asOfUnixMs + 300_000`, preserve the existing 24-hour ruleset position-age check, compute selection via a new exported `computeEvidenceSelectionHash`, and compare it to `expectedSelectionHash` before repository lookup/insert. Update all existing error instantiation sites across `insightsCurrent.ts`, `insightsHistory.ts`, `postgresPolicyInsightRepository.command.test.ts`, `getPolicyInsightHistoryUseCase.test.ts`, and `runSynthesisCycle.ts` to pass appropriate `errorCode` values.
- [ ] Re-run the targeted Vitest command plus `pnpm exec vitest run src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`, then run `pnpm exec eslint src/application/errors/policyInsightErrors.ts src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/getCurrentPolicyInsightUseCase.ts src/application/use-cases/getPolicyInsightHistoryUseCase.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/http/handlers/insightsCurrent.ts src/adapters/http/handlers/insightsHistory.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts src/workers/policyInsight/runSynthesisCycle.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts src/application/errors/__tests__/policyInsightErrors.test.ts`; expect success, followed by the automatic `pnpm -r typecheck` gate.
- [ ] Commit with `git add` for exactly the files in this task and `git commit -m "m79: classify position synthesis failures"`.

## Task 3: Create the durable Postgres position synthesis queue

**Files:**

- Create: `drizzle/0010_create_policy_insight_synthesis_requests.sql`
- Create: `drizzle/meta/0010_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Create: `src/ledger/pg/schema/policyInsightSynthesisRequests.ts`
- Modify: `src/ledger/pg/schema/index.ts`
- Modify: `src/ledger/pg/db.ts`
- Create: `src/ledger/pg/__tests__/policyInsightSynthesisRequestsMigration.test.ts`
- Create: `src/ledger/pg/schema/__tests__/policyInsightSynthesisRequests.shape.test.ts`
- Modify: `src/__tests__/pgStartup.test.ts`
- Modify: `src/server.ts`

**Exported API changes:** Export the Drizzle table/types and `verifyPolicyInsightSynthesisRequestsTable`.

**Behavioral invariants / tests written first:**

- `allows one ready request per scope selection plan and ruleset identity`.
- `keeps independent position scope keys in independent rows`.
- `requires coherent lease fields only while processing`.
- `allows waiting rows to omit exactly the unavailable hash`.
- `rejects invalid statuses negative attempts malformed hashes and terminal rows with active leases`.
- `fails API startup when the position synthesis requests table is absent`.

- [ ] Write schema-shape, migration, and startup-verification tests first.
- [ ] Run `pnpm exec vitest run src/ledger/pg/schema/__tests__/policyInsightSynthesisRequests.shape.test.ts src/__tests__/pgStartup.test.ts`; expect missing schema exports/verifier failures. With test Postgres available, run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisRequestsMigration.test.ts`; expect the missing table failure.
- [ ] Add `policy_insight_synthesis_requests` with identity/scope columns, nullable `selection_hash` and `plan_hash` for waiting rows, `ruleset_version`, status, attempt/retry timestamps, lease owner/timestamps, structured terminal error fields, and created/updated timestamps. Add a partial unique index on `(scope_key, selection_hash, plan_hash, ruleset_version)` when both hashes are non-null, a unique source-wake-up index for waiting rows, and a claim index on `(status, next_attempt_at_unix_ms, lease_expires_at_unix_ms, id)`.
- [ ] Generate Drizzle SQL/snapshot metadata with `pnpm run db:generate`, retain only migration `0010` and its generated metadata, then add the startup verifier alongside existing table verifiers and call it from `src/server.ts`.
- [ ] Run `pnpm exec vitest run src/ledger/pg/schema/__tests__/policyInsightSynthesisRequests.shape.test.ts src/__tests__/pgStartup.test.ts`, the Postgres migration test command above, and `pnpm exec eslint src/ledger/pg/schema/policyInsightSynthesisRequests.ts src/ledger/pg/schema/index.ts src/ledger/pg/db.ts src/ledger/pg/__tests__/policyInsightSynthesisRequestsMigration.test.ts src/ledger/pg/schema/__tests__/policyInsightSynthesisRequests.shape.test.ts src/__tests__/pgStartup.test.ts src/server.ts`; expect success and then the automatic typecheck gate.
- [ ] Commit the task files with `git commit -m "m79: add position synthesis request queue"`.

## Task 4: Implement atomic queue operations with lease recovery

**Files:**

- Create: `src/application/ports/positionPolicyInsightSynthesisQueuePort.ts`
- Create: `src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts`
- Create: `src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts`

**Exported API changes:** Add `PositionPolicyInsightSynthesisQueuePort` and its request/claim/result types. Every port method is implemented by the Postgres adapter in this same task.

**Behavioral invariants / tests written first:**

- `replaying an identical ready identity returns the original request id`.
- `evidence first persists waiting_for_plan and plan reconciliation promotes it to pending`.
- `plan first persists waiting_for_evidence and evidence reconciliation promotes it to pending`.
- `claims independent positions in deterministic id order with skip locked`.
- `does not steal an unexpired processing lease`.
- `reclaims an expired processing lease and increments attempt count`.
- `only the current lease owner can complete fail supersede or release a request`.
- `release for retry keeps the identity and makes it claimable only at retryAtUnixMs`.
- `converts release for retry into permanent failure with EXHAUSTED_RETRIES when attempt count reaches max attempts`.

- [ ] Write the adapter tests first against real Postgres transactions and isolate rows by unique scope prefixes.
- [ ] Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts`; expect failure because the port/adapter do not exist.
- [ ] Define and implement `enqueueOrReconcile`, `claimBatch`, `complete`, `fail`, `supersede`, `releaseForRetry`, `listWaitingScopes`, `listEligiblePositionScopes`, and `getById`. `listEligiblePositionScopes` reads distinct unexpired position evidence scopes for startup/internal backfill. `claimBatch` must select eligible IDs using `FOR UPDATE SKIP LOCKED` and update/return claims in one transaction. `releaseForRetry` evaluates `attempt_count` against `max_attempts` (default 5); if `attempt_count >= max_attempts`, it transitions status to `failed` with `errorCode: "EXHAUSTED_RETRIES"`, enforcing a strict retry budget and preventing infinite retries on poison pills. All terminal mutations include `WHERE id = ? AND lease_owner = ? AND status = 'processing'` and return a boolean.
- [ ] Re-run the Postgres test command and `pnpm exec eslint src/application/ports/positionPolicyInsightSynthesisQueuePort.ts src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts`; expect success and then the automatic typecheck gate.
- [ ] Commit with `git add src/application/ports/positionPolicyInsightSynthesisQueuePort.ts src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts && git commit -m "m79: lease position synthesis requests"`.

## Task 5: Reconcile evidence and plans into canonical queue identities

**Files:**

- Create: `src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts`
- Create: `src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`

**Exported API changes:** Add `RequestPositionPolicyInsightSynthesisUseCase`, its input/result types, and `createRequestPositionPolicyInsightSynthesisUseCase`.

**Behavioral invariants / tests written first:**

- `evidence without a plan returns waiting_for_plan with a durable request id`.
- `plan without evidence returns waiting_for_evidence with a durable request id`.
- `matching evidence and plan enqueue the exact scope selection plan and ruleset identity`.
- `duplicate reconciliation returns the same request id`.
- `two positions sharing one intelligence correlation reconcile independently`.
- `an expired waiting evidence request fails with POSITION_STALE when a plan arrives`.
- `a newer plan creates a distinct ready identity and leaves the older request eligible for supersession`.
- `wallet position pool or five minute skew mismatches never become pending`.

- [ ] Build fakes for the queue, evidence repository, plan ledger reader, clock, and selector; write every invariant as an exact test name before implementation.
- [ ] Run `pnpm exec vitest run src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`; expect the missing use case failure.
- [ ] Implement a use case that accepts a concrete position scope plus wake-up identity, loads the latest exact plan, reads latest evidence with the plan's inclusive five-minute bounds when possible, filters expired records, runs the existing pure selector, computes `selectionHash`, and calls `enqueueOrReconcile`. Return `{requestId, status, selectionHash, planHash, freshEvidenceRequired}` without synthesizing inline. For startup mode, reconcile the union of `listWaitingScopes`, currently unexpired position scopes supplied by the queue adapter, and `listLatestPositionPlans`; a plan-only scope becomes `waiting_for_evidence` with `freshEvidenceRequired: true` so deployment automation must initiate a fresh upstream intelligence run rather than silently declaring backfill complete.
- [ ] Re-run the targeted test and `pnpm exec eslint src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`; expect success and then the automatic typecheck gate.
- [ ] Commit with `git add src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts && git commit -m "m79: reconcile position synthesis inputs"`.

## Task 6: Wake the queue from evidence and plan persistence

**Files:**

- Modify: `src/application/use-cases/ingestEvidenceBundleUseCase.ts`
- Modify: `src/application/use-cases/generatePlanUseCase.ts`
- Modify: `src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/generatePlanUseCase.test.ts`
- Modify: `src/adapters/http/handlers/evidenceIngest.ts`
- Modify: `src/adapters/http/handlers/plan.ts`
- Create: `src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts`
- Create: `src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts`
- Modify: `src/composition/buildApplication.ts`
- Create: `src/composition/__tests__/positionPolicyInsightWiring.test.ts`

**Exported API changes:** Add an optional position-synthesis requester dependency to `createIngestEvidenceBundleUseCase` and `GeneratePlanUseCaseDeps`; extend `ApplicationDependencies` with the plan reader, queue, and requester. The optional dependency preserves SQLite-only operation, while Postgres composition always supplies it.

**Behavioral invariants / tests written first:**

- `new and idempotently replayed position evidence both wake reconciliation`.
- `non-position evidence never wakes the position queue`.
- `a persisted plan with wallet identity wakes reconciliation after SQLite commit`.
- `a plan without wallet identity remains valid but cannot form a position evidence scope`.
- `a queue outage after source persistence returns a retryable 503 and replay closes the wake-up gap`.
- `SQLite-only composition retains plan and evidence behavior without a queue`.

- [ ] Add the named tests to the existing small use-case test files and new focused handler/composition files. Do not add more cases to the existing 674-line evidence-ingest handler test.
- [ ] Run `pnpm exec vitest run src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/generatePlanUseCase.test.ts src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts src/composition/__tests__/positionPolicyInsightWiring.test.ts`; expect failures for missing wake-ups/wiring.
- [ ] Invoke reconciliation after `append` for both `created` and `already_ingested` position evidence. Invoke it after `writePlan` only when `position.walletId` exists, constructing the exact `solana-mainnet` position scope from request fields. Map structured queue/store unavailability to a sanitized 503 in both handlers so clients can safely replay already-persisted source data.
- [ ] Wire one SQLite read adapter and one Postgres queue adapter/requester in `buildApplication`; expose null requester/queue when Postgres is absent. Do not change `PlanLedgerWritePort.writePlan` or add a port method without its adapter.
- [ ] Re-run the targeted tests and `pnpm exec eslint src/application/use-cases/ingestEvidenceBundleUseCase.ts src/application/use-cases/generatePlanUseCase.ts src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/generatePlanUseCase.test.ts src/adapters/http/handlers/evidenceIngest.ts src/adapters/http/handlers/plan.ts src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts src/composition/buildApplication.ts src/composition/__tests__/positionPolicyInsightWiring.test.ts`; expect success and the automatic typecheck gate.
- [ ] Commit the task files with `git commit -m "m79: enqueue position synthesis from source writes"`.

## Task 7: Add the protected internal replay and backfill endpoint

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

## Task 8: Process position requests with structured retry and supersession

**Files:**

- Create: `src/workers/policyInsight/runPositionSynthesisCycle.ts`
- Create: `src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts`

**Exported API changes:** Add `runPositionPolicyInsightSynthesisCycle`, its dependencies, and discriminated result type.

**Behavioral invariants / tests written first:**

- `returns idle when no request can be claimed`.
- `loads the exact plan by hash and completes one matching request`.
- `supersedes a claim when a newer eligible plan exists`.
- `supersedes a claim when recomputed selectionHash differs`.
- `fails missing plan invalid hash stale evidence and scope mismatch with their structured codes`.
- `retries market evidence and policy store outages without inspecting messages`.
- `fails a transient request after the configured retry budget is exhausted`.
- `returns lease_lost when a stale worker cannot mutate the claimed request`.

- [ ] Write one test per invariant with fake queue/read/synthesis ports and error messages deliberately unrelated to classification.
- [ ] Run `pnpm exec vitest run src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts`; expect the missing cycle failure.
- [ ] Claim a bounded batch, compare each claim with `getLatestPositionPlan` and `getPositionPlanByHash`, then call synthesis with exact `positionPlan` and `expectedSelectionHash`. Switch only on `error.errorCode`: validation codes fail, `EVIDENCE_SELECTION_SUPERSEDED` or newer plans supersede, and unavailable codes retry with capped attempts. All logs contain request/scope/hash/attempt/duration but no raw payload or secret.
- [ ] Re-run the targeted test and `pnpm exec eslint src/workers/policyInsight/runPositionSynthesisCycle.ts src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts`; expect success and the automatic typecheck gate.
- [ ] Commit with `git add src/workers/policyInsight/runPositionSynthesisCycle.ts src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts && git commit -m "m79: process position synthesis requests"`.

## Task 9: Run and verify the position worker in the HTTP service

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
