<!-- plan-review-required -->

# Pair-Scoped PolicyInsight Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durably synthesize the current pair-scoped SOL/USDC `PolicyInsight` from newly ingested pair-safe evidence, including evidence that predates deployment, without coupling synthesis failures to the evidence-ingest HTTP response.

**Architecture:** A Postgres cursor row is the durable source of truth. A dedicated worker claims the newest unprocessed pair receipt under a lease, calls the existing synthesis use case with a validated canonical market selector, and advances the cursor only after success or a classified permanent failure; transient failures release the lease for retry. Selecting only the newest receipt above the cursor coalesces bursts, while the existing `synthesisInputHash` uniqueness path remains the final idempotency guard.

**Tech Stack:** TypeScript, Node.js 22, Postgres, Drizzle ORM/Drizzle Kit, Vitest, Fastify composition, existing policy synthesis application services.

---

## Goal

- Automatically create evidence-informed pair-scoped insights after pair-safe evidence is committed.
- Preserve `POST /v1/evidence` response behavior: a created bundle returns `201` even when synthesis or candle/regime reads are unavailable.
- Recover after process restarts and explicitly backfill evidence received before this feature is deployed.
- Make concurrent workers and duplicate evidence safe through a persisted lease/cursor plus synthesis replay detection.

## Non-goals

- No changes to `sol-usdc-clmm-intelligence`; this plan assumes its companion change publishes `scope.kind: "pair"` bundles.
- No position-to-pair projection and no use of position, wallet, inventory, or range evidence in pair insights.
- No synthesis for position, wallet, or legacy whirlpool scopes.
- No new HTTP endpoint and no synchronous or fire-and-forget synthesis call from `src/adapters/http/handlers/evidenceIngest.ts`.
- No replacement of the existing policy reducer, evidence selection rules, or `synthesisInputHash` replay behavior.

## Affected files

- Create `src/workers/policyInsight/config.ts` and `src/workers/policyInsight/__tests__/config.test.ts` for canonical market and worker timing configuration.
- Create `drizzle/0009_create_policy_insight_synthesis_cursor.sql`, `drizzle/meta/0009_snapshot.json`, `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`, and `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`; modify `drizzle/meta/_journal.json`, `src/ledger/pg/schema/index.ts`, `src/ledger/pg/db.ts`, `src/server.ts`, and `src/__tests__/pgStartup.test.ts` for schema/startup verification.
- Create `src/application/ports/policyInsightSynthesisTriggerPort.ts`, `src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts`, and `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts` for durable claims and cursor transitions.
- Create `src/workers/policyInsight/runSynthesisCycle.ts` and `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts` for one deterministic claim/synthesize/classify/complete cycle.
- Create `src/workers/policyInsightSynthesisWorker.ts` and `src/workers/__tests__/policyInsightSynthesisWorker.test.ts` for process composition, polling, shutdown, and health behavior.
- Create `scripts/backfill-pair-insights.ts`; modify `package.json`, `.env.example`, `scripts/start.sh`, `scripts/predeploy.sh`, and `docs/runbooks/railway-deploy.md` for executable and deployment wiring.
- Create `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`; modify `package.json` to include it in the Postgres test command.
- Read only: `src/adapters/http/handlers/evidenceIngest.ts`, `src/application/use-cases/ingestEvidenceBundleUseCase.ts`, `src/application/use-cases/synthesizePolicyInsightUseCase.ts`, `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts`, `src/application/ports/policyInsightRepositoryPort.ts`, `src/adapters/postgres/postgresEvidenceBundleRepository.ts`, and `src/adapters/postgres/postgresPolicyInsightRepository.ts`.

## Behavioral invariants

The implementer must write the named tests below before implementation. The manifest repeats each invariant on its owning task.

1. A missing or placeholder canonical pool address is a startup/configuration error; valid config always resolves `{ source: "geckoterminal", network: "solana", poolAddress, timeframe: "1h" }`.
2. With no cursor row, the first claim selects the newest pair-scoped evidence receipt, so pre-deployment evidence is backfilled without replaying every older receipt.
3. With a completed cursor, a claim selects only the newest pair receipt whose ID is greater than the cursor; position and other scopes never become claims.
4. While an unexpired lease exists, another worker receives no claim. After lease expiry, the same target is recoverable by another worker.
5. Completing a claim is compare-and-set on owner and target receipt. Stale owners cannot advance the cursor or overwrite newer state.
6. A successful synthesis advances the cursor, records success, clears lease/retry state, and logs receipt ID, pair scope, synthesis input hash, insight ID, and duration.
7. A permanent validation/configuration failure is logged and advances past the poison receipt with a permanent-failure outcome; it does not block later evidence.
8. A transient store, candle, regime, or unknown operational failure records the classified error and releases the lease with bounded backoff for retry while `attemptCount` is below `maxAttempts` (default 5). When `attemptCount` reaches `maxAttempts`, the cycle converts the transient failure into a permanent failure, logs that the retry budget was exhausted, and completes to advance the cursor past the failing receipt.
9. Multiple pair receipts arriving before a claim are coalesced into one synthesis attempt for the highest receipt ID.
10. An identical evidence replay creates no new evidence row, yields no new claim after the cursor is current, and the existing `synthesisInputHash` path prevents duplicate insights if overlapping leases ever synthesize the same inputs.
11. The worker runs one cycle immediately on startup, sleeps only after the cycle, continues after recoverable cycle failures, and stops cleanly on abort/SIGTERM/SIGINT.
12. The evidence HTTP handler awaits ingestion only; worker failures occur in another process and therefore cannot change a created ingest response from `201`.

## Task 1: Validate canonical pair synthesis configuration

**Files:**

- Create: `src/workers/policyInsight/config.ts`
- Create: `src/workers/policyInsight/__tests__/config.test.ts`
- Reference: `src/workers/gecko/config.ts`
- Reference: `src/engine/marketRegime/config.ts`

- [ ] **Step 1: Write failing configuration tests.** Define exact tests named `rejects a missing canonical SOL/USDC pool address`, `rejects placeholder pool addresses`, `returns the canonical pair market selector`, and `validates positive poll lease retry intervals and max attempts budget`. Cover defaults of source `geckoterminal`, network `solana`, timeframe `1h`, a 5-second poll, a 60-second lease, a bounded retry interval no greater than the lease, and default `maxAttempts` of 5.
- [ ] **Step 2: Verify the focused test fails because the parser does not exist.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/config.test.ts`; expect module-resolution/test failures.
- [ ] **Step 3: Implement the typed parser.** Export `PolicyInsightSynthesisWorkerConfig` and `parsePolicyInsightSynthesisWorkerConfig(env)`. Require `CANONICAL_SOL_USDC_POOL_ADDRESS`, reject empty strings and `<`/`>` placeholders, keep source/network/timeframe as literal canonical values, and parse positive integer `POLICY_INSIGHT_SYNTHESIS_POLL_INTERVAL_MS`, `POLICY_INSIGHT_SYNTHESIS_LEASE_MS`, `POLICY_INSIGHT_SYNTHESIS_RETRY_MS`, and `POLICY_INSIGHT_SYNTHESIS_MAX_ATTEMPTS` (default 5) values. The returned config must contain a reusable `marketSelector` matching `SynthesizePolicyInsightInput["marketSelector"]` and positive `maxAttempts` budget.
- [ ] **Step 4: Run focused verification.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/config.test.ts` and `pnpm exec eslint src/workers/policyInsight/config.ts src/workers/policyInsight/__tests__/config.test.ts`; expect all checks to pass with zero warnings.
- [ ] **Step 5: Commit.** Commit as `m78: add pair synthesis worker configuration`.

## Task 2: Add the durable synthesis cursor schema

**Files:**

- Create: `drizzle/0009_create_policy_insight_synthesis_cursor.sql`
- Create: `drizzle/meta/0009_snapshot.json`
- Create: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Create: `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/ledger/pg/schema/index.ts`
- Modify: `src/ledger/pg/db.ts`
- Modify: `src/server.ts`
- Modify: `src/__tests__/pgStartup.test.ts`
- Reference: `drizzle/0008_widen_evidence_correlation_id.sql`
- Reference: `src/ledger/pg/schema/evidenceBundles.ts`

- [ ] **Step 1: Write failing migration and startup tests.** Name the cases `creates one pair synthesis cursor row per cursor key`, `enforces non-negative receipt and retry values`, `supports an expiring lease and classified outcome`, `resolves when policy_insight_synthesis_cursor exists`, and `fails startup when policy_insight_synthesis_cursor is missing`.
- [ ] **Step 2: Verify the focused tests fail.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts src/__tests__/pgStartup.test.ts`; expect the missing table/export assertions to fail.
- [ ] **Step 3: Add migration and Drizzle schema.** Create `regime_engine.policy_insight_synthesis_cursor` keyed by `cursor_key` with `last_processed_receipt_id`, nullable `target_receipt_id`, nullable `lease_owner`, nullable `lease_expires_at_unix_ms`, `attempt_count`, nullable `next_attempt_at_unix_ms`, nullable `last_outcome` constrained to `success`, `permanent_failure`, or `transient_failure`, nullable bounded `last_error_code`/`last_error_message`, and `updated_at_unix_ms`. Add checks for non-negative numeric values and coherent all-null/all-present lease fields. Export `policyInsightSynthesisCursor` plus inferred row/insert types from the schema index.
- [ ] **Step 4: Register migration metadata.** Generate the matching `0009_snapshot.json` and journal entry using the repository's existing Drizzle conventions; inspect the generated SQL and keep the migration additive and forward-only.
- [ ] **Step 5: Add startup verification.** Export `verifyPolicyInsightSynthesisCursorTable(db)` from `src/ledger/pg/db.ts`, invoke it in `src/server.ts` after evidence/policy table verification, and test both present and missing-table behavior.
- [ ] **Step 6: Run focused verification.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts src/__tests__/pgStartup.test.ts` and `pnpm exec eslint src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/schema/index.ts src/ledger/pg/db.ts src/server.ts src/__tests__/pgStartup.test.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`; expect pass/zero warnings. If Postgres is unavailable, record the PG test as unexecuted rather than treating a skipped test as proof.
- [ ] **Step 7: Commit.** Commit as `m78: persist pair synthesis cursor state`.

## Task 3: Implement leased cursor transitions in the Postgres adapter

**Files:**

- Create: `src/application/ports/policyInsightSynthesisTriggerPort.ts`
- Create: `src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts`
- Create: `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`
- Reference: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Reference: `src/ledger/pg/schema/evidenceBundles.ts`
- Reference: `src/adapters/postgres/postgresEvidenceBundleRepository.ts`

- [ ] **Step 1: Write the state-transition tests first.** Add the exact cases `claims the newest historical pair receipt when the cursor is absent`, `coalesces multiple pending pair receipts to the highest id`, `never claims non-pair evidence`, `returns idle while another unexpired lease owns the claim`, `reclaims the target after lease expiry`, `only the matching owner and target can complete a claim`, `success advances the cursor and clears retry state`, `permanent failure advances the cursor`, and `transient failure preserves the cursor and schedules retry`.
- [ ] **Step 2: Verify the adapter test fails.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`; expect missing port/adapter failures.
- [ ] **Step 3: Define the port and implement every method in the same task.** Export `PolicyInsightSynthesisClaim`, `PolicyInsightSynthesisOutcome`, and `PolicyInsightSynthesisTriggerPort` with methods `claimLatestPairEvidence(input)`, `complete(input)`, and `releaseForRetry(input)`. `PolicyInsightSynthesisClaim` must include `targetReceiptId`, `attemptCount`, and `leaseOwner`. Each mutation input must include `cursorKey`, `leaseOwner`, `targetReceiptId`, and a captured `nowUnixMs`; claims additionally include `leaseDurationMs`, and retry release includes classification, sanitized message, and `retryAtUnixMs`.
- [ ] **Step 4: Implement atomic Postgres transitions.** `claimLatestPairEvidence` must use one transaction and row locking/upsert semantics to initialize the cursor, honor `next_attempt_at_unix_ms`, reject live leases, select `MAX(evidence_bundles.id)` where `pair = 'SOL/USDC'`, `scope_key = 'pair'`, and ID is above the cursor, then lease only that target. `complete` and `releaseForRetry` must use owner+target compare-and-set predicates and return whether the transition applied. Do not mark `evidence_bundles.processed_at_unix_ms`; the cursor table is the sole trigger state.
- [ ] **Step 5: Run focused verification.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts` and `pnpm exec eslint src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`; expect all transition tests to pass. This task deliberately combines the new port and its only adapter so workspace typechecking is never left with an unimplemented interface.
- [ ] **Step 6: Commit.** Commit as `m78: add leased pair synthesis trigger adapter`.

## Task 4: Implement one pair synthesis cycle and failure classification

**Files:**

- Create: `src/workers/policyInsight/runSynthesisCycle.ts`
- Create: `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`
- Reference: `src/application/ports/policyInsightSynthesisTriggerPort.ts`
- Reference: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Reference: `src/application/errors/policyInsightErrors.ts`
- Reference: `src/application/errors/evidenceErrors.ts`
- Reference: `src/application/errors/regimeErrors.ts`
- Reference: `src/workers/gecko/logger.ts`

- [ ] **Step 1: Write failing cycle tests.** Add exact cases `returns idle without calling synthesis when no receipt is claimable`, `synthesizes pair scope with the canonical market selector`, `logs required identifiers and duration before completing success`, `classifies validation failure as permanent and advances the cursor`, `classifies store and regime availability failures as transient without advancing when below max attempts`, `converts transient failure to permanent failure when attempt count reaches max attempts budget`, `classifies an unknown operational error as transient`, and `does not advance when completion compare-and-set loses ownership`.
- [ ] **Step 2: Verify the tests fail.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`; expect the cycle module to be missing.
- [ ] **Step 3: Implement `runPolicyInsightSynthesisCycle`.** Inject the trigger port, `SynthesizePolicyInsightUseCase`, config, logger, stable `leaseOwner`, and clock. Capture start time, claim once, call synthesis exactly once with `{ scope: { kind: "pair" }, marketSelector, positionPlan: null }`, and return a discriminated result `idle | succeeded | permanent_failure | transient_failure | lease_lost` for testability.
- [ ] **Step 4: Implement explicit failure classification, retry budget enforcement, and safe logging.** Treat `PolicyInsightValidationError` and invalid canonical configuration as permanent; treat policy/evidence store unavailability, regime/candle availability errors, and unknown runtime errors as transient when `claim.attemptCount < config.maxAttempts`. When a transient failure occurs and `claim.attemptCount >= config.maxAttempts`, convert the outcome to permanent failure, log that the retry budget (`maxAttempts`) was exhausted for `receiptId`, and invoke `triggerPort.complete` with outcome `permanent_failure` to advance past the poison receipt. Log `receiptId`, `scope: "pair"`, `synthesisInputHash` and `insightId` from the successful read model, `durationMs`, `attemptCount`, outcome, and sanitized error code/message. Never log evidence payloads, tokens, or database URLs.
- [ ] **Step 5: Run focused verification.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts` and `pnpm exec eslint src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`; expect pass/zero warnings.
- [ ] **Step 6: Commit.** Commit as `m78: synthesize pair insights from durable claims`.

## Task 5: Add the restart-safe polling worker process

**Files:**

- Create: `src/workers/policyInsightSynthesisWorker.ts`
- Create: `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`
- Reference: `src/composition/buildStoreContext.ts`
- Reference: `src/composition/buildApplication.ts`
- Reference: `src/workers/geckoCollector.ts`
- Reference: `src/workers/policyInsight/runSynthesisCycle.ts`

- [ ] **Step 1: Write failing loop and lifecycle tests.** Add exact cases `runs a synthesis cycle immediately before the first sleep`, `continues polling after a transient cycle result`, `continues polling after an unexpected cycle throw`, `stops without another claim after abort`, `removes installed signal handlers on shutdown`, `fails startup without postgres-backed synthesis dependencies`, and `closes the store context exactly once`.
- [ ] **Step 2: Verify the tests fail.** Run `pnpm exec vitest run src/workers/__tests__/policyInsightSynthesisWorker.test.ts`; expect the worker module to be missing.
- [ ] **Step 3: Implement the polling loop.** Export `runPolicyInsightSynthesisWorker(config?, deps?)`, use an abort-aware sleep, run immediately, then poll at the configured interval. Cycle errors must be logged and followed by another poll unless aborted. Use a UUID/process-unique lease owner and install/remove SIGTERM/SIGINT listeners only when the worker owns its controller.
- [ ] **Step 4: Compose production dependencies.** In main-module execution, build the store context and application, require Postgres plus `synthesizePolicyInsight`, construct the Postgres trigger adapter and cycle, expose a minimal `/health` server for Railway, and close both health server and store context on shutdown or fatal startup. Do not register or call the evidence HTTP handler.
- [ ] **Step 5: Run focused verification.** Run `pnpm exec vitest run src/workers/__tests__/policyInsightSynthesisWorker.test.ts` and `pnpm exec eslint src/workers/policyInsightSynthesisWorker.ts src/workers/__tests__/policyInsightSynthesisWorker.test.ts`; expect pass/zero warnings.
- [ ] **Step 6: Commit.** Commit as `m78: run durable policy insight synthesis worker`.

## Task 6: Add explicit backfill and deployment wiring

**Files:**

- Create: `scripts/backfill-pair-insights.ts`
- Modify: `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `scripts/start.sh`
- Modify: `scripts/predeploy.sh`
- Modify: `docs/runbooks/railway-deploy.md`
- Reference: `src/workers/policyInsightSynthesisWorker.ts`
- Reference: `src/workers/policyInsight/runSynthesisCycle.ts`

- [ ] **Step 1: Write script-level contract tests in the existing worker test file.** Keep executable dispatch behind small exported functions and add the exact cases `backfill exits zero after success or idle`, `backfill exits nonzero after transient failure`, and `service dispatch starts the synthesis worker only for synthesis-worker service type`.
- [ ] **Step 2: Implement the one-shot backfill command.** Compose the same config, store, trigger adapter, and synthesis use case as the worker; run exactly one cycle (which selects the newest historical pair receipt when the cursor is absent); emit a structured result; close resources in `finally`; return nonzero for transient/fatal setup failures. Do not reset or rewind an existing cursor.
- [ ] **Step 3: Add package and shell dispatch.** Add `dev:policy-insights`, `start:policy-insights`, and `backfill:pair-insights` scripts. Extend `scripts/start.sh` with explicit `api`, `collector`, and `synthesis-worker` cases and reject unknown service types. Ensure `scripts/predeploy.sh` skips migrations only for the collector, while API/synthesis-worker deployments still use the shared migration history safely.
- [ ] **Step 4: Document configuration and rollout.** Add the canonical pool, polling, lease, retry, and max attempts (`POLICY_INSIGHT_SYNTHESIS_MAX_ATTEMPTS`) variables to `.env.example`. Extend the Railway runbook with a synthesis-worker service, its health check, the explicit `pnpm run backfill:pair-insights` deployment command, log fields, a current-insight smoke check, restart recovery, and forward-only rollback guidance. State that the companion pair-safe publisher must be live before enabling the worker.
- [ ] **Step 5: Run focused verification.** Run `pnpm exec vitest run src/workers/__tests__/policyInsightSynthesisWorker.test.ts`, `pnpm exec eslint scripts/backfill-pair-insights.ts src/workers/policyInsightSynthesisWorker.ts`, `pnpm exec prettier --check package.json .env.example scripts/start.sh scripts/predeploy.sh docs/runbooks/railway-deploy.md`, and `bash -n scripts/start.sh scripts/predeploy.sh`; expect all checks to pass.
- [ ] **Step 6: Commit.** Commit as `m78: wire policy insight backfill deployment`.

## Task 7: Prove pair evidence, replay safety, and HTTP isolation end to end

**Files:**

- Create: `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`
- Modify: `package.json`
- Reference: `src/adapters/http/handlers/evidenceIngest.ts`
- Reference: `src/application/use-cases/ingestEvidenceBundleUseCase.ts`
- Reference: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Reference: `src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`
- Reference: `contracts/evidence-bundle/v1/fixtures/valid/deterministic-only.json`

- [ ] **Step 1: Write the Postgres end-to-end tests first.** Add exact cases `backfills the newest pre-existing pair evidence into current insight`, `current pair insight includes selected lineage from pair evidence`, `coalesces two created receipts into one latest-input synthesis`, `duplicate evidence replay creates neither a new claim nor a duplicate insight`, `overlapping synthesis attempts converge on one synthesis input hash`, and `created evidence still returns 201 while the worker later records a transient synthesis failure`.
- [ ] **Step 2: Verify the new suite fails before final wiring.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`; expect failures until the migration, adapter, worker, candles, evidence, and current endpoint are composed in the fixture.
- [ ] **Step 3: Build deterministic fixtures.** Insert enough canonical 15-minute candle revisions for the existing 1-hour regime path, ingest valid pair-safe evidence through the real HTTP route, run the real cycle with a fixed clock, and read `GET /v1/insights/sol-usdc/current` without query parameters. Assert included lineage/evidence coverage rather than merely asserting `200`.
- [ ] **Step 4: Cover replay and isolation.** Replay the identical evidence run and assert the original receipt, no new claim, one `policy_insights` row for the synthesis input hash, and stable insight ID. Inject a temporarily unavailable regime/synthesis dependency after a created ingest response and assert the HTTP response remains `201` while cursor state remains retryable.
- [ ] **Step 5: Register the focused PG suite.** Add the new test path to `test:pg` without removing any existing paths.
- [ ] **Step 6: Run focused verification.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts` and `pnpm exec eslint src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`; expect every acceptance test to pass. A skip caused by missing `DATABASE_URL` is not acceptance evidence.
- [ ] **Step 7: Commit.** Commit as `m78: verify pair insight trigger end to end`.

## Tests to add or update

- Unit config validation in `src/workers/policyInsight/__tests__/config.test.ts`.
- Postgres migration constraints and startup verification in `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts` and `src/__tests__/pgStartup.test.ts`.
- Postgres state-transition and concurrency tests in `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`.
- Pure cycle classification/logging tests in `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`.
- Loop, shutdown, composition, and backfill dispatch tests in `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`.
- Postgres end-to-end acceptance coverage in `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`.
- Do not expand the 674-line `src/adapters/http/handlers/__tests__/evidenceIngest.test.ts`; the new worker E2E suite proves isolation without adding another oversized test-update task.

## Validation commands

After all implementation tasks, the dedicated validation phase should run exactly:

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
docker compose -f docker-compose.test.yml down
```

The implementer must also perform the documented one-shot smoke check with valid local configuration:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false CANONICAL_SOL_USDC_POOL_ADDRESS=PoolTest111 pnpm run backfill:pair-insights
```

Expected result: structured `succeeded` or `idle`, never an unhandled rejection; after seeded pair evidence and candles, the current pair endpoint returns an insight whose selected lineage includes that evidence.

## Risk areas

- Lease correctness: a stale worker must not advance or release a claim owned by a newer worker.
- Poison evidence: permanent classification must be narrow enough not to discard recoverable infrastructure failures, but must prevent a structurally invalid receipt from blocking all newer evidence.
- Coalescing semantics intentionally synthesize only the newest pending pair receipt; older receipts remain in the append-only evidence history but do not each create an insight.
- The canonical pool must exactly match candle ingestion; a syntactically valid but wrong pool causes persistent missing-regime retries.
- A lease can expire during slow synthesis. The policy repository's unique synthesis fingerprint is therefore still required to converge overlapping attempts.
- Migration metadata must match the hand-authored SQL/schema and remain forward-only in production.
- Worker deployment is operationally required. Shipping code without enabling the synthesis-worker service leaves the cursor untouched, although explicit backfill remains available.
- Pair safety is an upstream trust boundary. Regime Engine uses scope-exact selection and must not reinterpret position evidence as pair evidence.

## Stop conditions

- Stop if the companion publisher does not produce a contract-valid `scope.kind: "pair"` bundle containing only pair-safe data; do not substitute position evidence or a market-only insight.
- Stop if the production canonical SOL/USDC pool address cannot be confirmed against the candle collector configuration.
- Stop if the cursor migration cannot be applied additively or Drizzle metadata disagrees with the SQL; do not edit production migration history or drop data.
- Stop if Postgres transition tests cannot exercise a real database; skipped tests are not enough to approve lease/cursor behavior.
- Stop if the existing `synthesisInputHash` uniqueness/replay tests regress, because lease expiry can otherwise create duplicate insights.
- Stop if implementing the trigger would require awaiting synthesis from `evidenceIngest.ts` or changing a created ingest response based on worker health.
- Stop if transient failure handling advances the cursor without reaching max attempts, or if retries exceed max attempts without converting to permanent failure and advancing.
- Stop if the no-parameter current endpoint returns `200` but the resulting insight has empty selected lineage despite valid fresh pair evidence; that is the degraded behavior this issue forbids.
