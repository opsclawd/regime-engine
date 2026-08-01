<!-- plan-review-required -->

# Dual-Source Pair PolicyInsight Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pair-scoped PolicyInsight synthesis claim work whenever either SOL/USDC evidence bundles or SOL/USDC `sr_theses_v2` rows advance, while retaining safe lease, retry, and compare-and-set behavior for one atomic dual-pointer claim.

**Architecture:** Extend the existing PostgreSQL synthesis cursor with independent last-processed and in-flight targets for SR theses. The PostgreSQL trigger adapter will snapshot both source maxima under the existing cursor-row lock, treat the pair of maxima as the claim identity, and advance or release the pair together. The worker remains responsible only for coordinating synthesis and will propagate both target components through every terminal path.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM/Drizzle Kit, PostgreSQL, Vitest, ESLint, pnpm.

---

## Goal

Allow a fresh `regime_engine.sr_theses_v2` row with `symbol = 'SOL/USDC'` to trigger the existing pair synthesis worker even when `regime_engine.evidence_bundles` has not advanced. Preserve evidence-only triggering and prevent repeated cycles by completing, retrying, and compare-and-setting against a two-component cursor.

## Non-goals

- Do not repair or reconfigure the `sol-usdc-clmm-intelligence` collectors.
- Do not alter position-scoped synthesis or `policy_insight_synthesis_requests`.
- Do not change PolicyInsight synthesis inputs, selection logic, hashing, or output contracts.
- Do not add on-chain execution behavior or change the HTTP ingestion contracts.
- Do not generalize the cursor into an arbitrary trigger registry; this change adds only the known SR-thesis pointer.
- Do not reinterpret `targetReceiptId` as an opaque combined value. It remains the evidence-bundle component, and `targetSrThesesMaxId` is the SR component.

## Assumptions

- `sr_theses_v2.id` is the monotonically increasing trigger pointer and `sr_theses_v2.symbol` uses the same pair string passed to `claimLatestPairEvidence` (default `SOL/USDC`).
- Existing cursor rows are pair rows and may safely backfill `last_processed_sr_theses_max_id` to `0`.
- An empty source table has an effective maximum of `0`; a claim is idle only when both effective maxima are less than or equal to their respective last-processed values.
- For an SR-only cycle, the existing worker result/log field `receiptId` may be `0` or the unchanged evidence maximum. It remains the evidence component for backward compatibility; this issue does not widen worker result or logging contracts.
- `complete(..., outcome: "permanent_failure")` intentionally consumes both claimed pointers, matching current permanent-failure behavior for evidence receipts. A transient failure consumes neither.

## Affected files

- `src/ledger/pg/schema/policyInsightSynthesisCursor.ts` — define the two SR cursor columns and extend cursor constraints.
- `drizzle/0011_extend_policy_insight_synthesis_cursor.sql` — add/backfill columns and replace constraints safely.
- `drizzle/meta/0011_snapshot.json` — generated Drizzle schema snapshot.
- `drizzle/meta/_journal.json` — register migration 0011.
- `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts` — prove defaults, non-negativity, and four-field lease coherence.
- `src/application/ports/policyInsightSynthesisTriggerPort.ts` — expose both cursor components in claims, completion, and retry inputs.
- `src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts` — claim, compare, complete, and release both cursor components atomically.
- `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts` — cover all dual-source state transitions and compare-and-set behavior.
- `src/workers/policyInsight/runSynthesisCycle.ts` — propagate the SR target through success, permanent-failure, and retry paths.
- `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts` — update claim fixtures and assert propagation on each terminal path.
- `src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts` — prove an SR-only ingestion produces and exposes an insight, then becomes idle.
- `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts` — retain evidence-only coverage and assert both cursor components settle without retriggering.

## Behavioral invariants

These names are the exact test names to write before implementation:

- `defaults the SR last-processed cursor to zero for existing and new rows`: migrated and newly inserted cursor rows start with `last_processed_sr_theses_max_id = 0` unless explicitly supplied.
- `requires both claim targets whenever a lease is active`: an active lease is valid only when owner, expiry, evidence target, and SR target are all non-null; an idle cursor requires all four lease/target fields to be null; a retry-cooldown cursor requires both target fields non-null, next_attempt_at_unix_ms non-null, and lease fields null.
- `rejects negative SR cursor values`: neither SR last-processed nor SR target may be negative.
- `claims when only evidence advances and snapshots both source maxima`: evidence advancement produces one claim even with no new SR row, and the claim stores the current maximum for each source.
- `claims when only SR theses advance and snapshots both source maxima`: SR advancement produces one claim even with no evidence row.
- `returns idle when neither source has advanced`: equal or lower source maxima do not create a lease.
- `coalesces simultaneous evidence and SR advances into one dual-pointer claim`: when both sources advance before polling, one claim targets both newest IDs.
- `increments attempts only when reclaiming the same dual-pointer target`: an expired/retried identical target pair increments `attempt_count`; a change to either target resets it to `1`.
- `completion requires the matching owner and both targets`: any owner, evidence-target, or SR-target mismatch loses the compare-and-set and advances neither pointer.
- `completion advances both pointers to the exact claimed targets`: success and permanent failure copy both targets to their last-processed columns and clear both targets plus lease/retry state.
- `transient release preserves both processed pointers and retries the same target pair`: retry release clears lease owner and expiry, preserves both target pointers and both last-processed values, schedules retry in next_attempt_at_unix_ms, and later reclaims the unchanged target pair with an incremented attempt.
- `does not ping-pong after completing a single-source advance`: after either source alone caused a completed claim, the next poll is idle until one source advances again.
- `propagates both claim targets through every worker terminal path`: worker success, permanent failure, retry, and lease-loss handling use the SR target from the same claim as the evidence target.
- `synthesizes and serves a pair insight from an SR-only trigger`: with candles and SR theses but zero evidence bundles, one worker cycle succeeds, the current endpoint reflects SR levels, both cursor pointers settle, and the next cycle is idle.
- `evidence-only synthesis remains independently triggerable`: with evidence and no SR theses, the worker still succeeds, leaves the SR pointer at zero, advances the evidence pointer, and the next cycle is idle.

## Task 1: Add the dual-pointer cursor migration and schema constraints

**Files:**

- Modify: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Create: `drizzle/0011_extend_policy_insight_synthesis_cursor.sql`
- Create: `drizzle/meta/0011_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`
- Reference only: `drizzle/0009_create_policy_insight_synthesis_cursor.sql`
- Reference only: `src/ledger/pg/schema/srThesesV2.ts`
- Reference only: `src/ledger/pg/schema/index.ts`
- Reference only: `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`

**Behavioral invariants:**

- `defaults the SR last-processed cursor to zero for existing and new rows`
- `requires both claim targets whenever a lease is active`
- `rejects negative SR cursor values`

- [ ] **Step 1: Write the failing migration tests.** Extend the insert/select assertions with `last_processed_sr_theses_max_id` and `target_sr_theses_max_id`. Add focused cases that verify migration backfills `target_sr_theses_max_id = 0` for active legacy leases, insert of negative SR values is rejected, and all three valid lease/target states (idle, leased, and retry cooldown) are validated. Keep the existing primary-key, legacy non-negative, and outcome checks.

  The new assertions should use the exact test names above and explicitly verify an insert that omits `last_processed_sr_theses_max_id` reads back as numeric `0`.

- [ ] **Step 2: Run the focused migration test and confirm it fails because the SR cursor columns do not exist.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`

  Expected: FAIL on the first reference to `last_processed_sr_theses_max_id` or `target_sr_theses_max_id`, before the migration is added and applied.

- [ ] **Step 3: Extend the Drizzle table definition.** Add:

  ```ts
  lastProcessedSrThesesMaxId: bigint("last_processed_sr_theses_max_id", {
    mode: "number"
  })
    .notNull()
    .default(0),
  targetSrThesesMaxId: bigint("target_sr_theses_max_id", { mode: "number" }),
  ```

  Extend `chk_synthesis_cursor_non_negative` so both new values are non-negative (with the target nullable). Extend `chk_synthesis_cursor_lease_coherence` to cover all three valid cursor states: idle (`leaseOwner` NULL, `targetReceiptId` NULL, `targetSrThesesMaxId` NULL, `nextAttemptAtUnixMs` NULL), leased (`leaseOwner` NOT NULL, `leaseExpiresAtUnixMs` NOT NULL, `targetReceiptId` NOT NULL, `targetSrThesesMaxId` NOT NULL), and retry cooldown (`leaseOwner` NULL, `leaseExpiresAtUnixMs` NULL, `targetReceiptId` NOT NULL, `targetSrThesesMaxId` NOT NULL, `nextAttemptAtUnixMs` NOT NULL).

- [ ] **Step 4: Generate and inspect the additive migration artifacts.**

  Run: `pnpm exec drizzle-kit generate --name=extend_policy_insight_synthesis_cursor`

  Expected: creates `drizzle/0011_extend_policy_insight_synthesis_cursor.sql`, `drizzle/meta/0011_snapshot.json`, and appends entry 11 to `drizzle/meta/_journal.json`.

  Inspect the SQL and keep only an additive/backward-safe sequence: add `last_processed_sr_theses_max_id bigint DEFAULT 0 NOT NULL`, add nullable `target_sr_theses_max_id`, backfill existing active and retry-cooldown leases (`UPDATE regime_engine.policy_insight_synthesis_cursor SET target_sr_theses_max_id = 0 WHERE (lease_owner IS NOT NULL OR target_receipt_id IS NOT NULL) AND target_sr_theses_max_id IS NULL;`), drop the two named cursor constraints, then recreate them with both pointer components supporting idle, leased, and retry-cooldown cursor states. Do not drop/recreate the table or alter unrelated objects.

- [ ] **Step 5: Apply the migration to the test database and run the focused tests.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate`

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`

  Expected: migration applies once; the focused test passes and confirms defaulting, non-negativity, and lease coherence.

- [ ] **Step 6: Check only the changed TypeScript files for lint/format issues.**

  Run: `pnpm exec eslint src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts`

  Run: `pnpm exec prettier --check src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts drizzle/0011_extend_policy_insight_synthesis_cursor.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json`

  Expected: both commands exit 0.

- [ ] **Step 7: Commit the schema unit.**

  ```bash
  git add src/ledger/pg/schema/policyInsightSynthesisCursor.ts src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts drizzle/0011_extend_policy_insight_synthesis_cursor.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json
  git commit -m "m84: add dual-source synthesis cursor"
  ```

## Task 2: Implement atomic dual-source claim, completion, and retry coordination

**Files:**

- Modify: `src/application/ports/policyInsightSynthesisTriggerPort.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`
- Modify: `src/workers/policyInsight/runSynthesisCycle.ts`
- Modify: `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`
- Reference only: `src/ledger/pg/schema/srThesesV2.ts`
- Reference only: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Reference only: `src/workers/policyInsightSynthesisWorker.ts`
- Reference only: `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`

This task intentionally keeps the exported port shapes, their only PostgreSQL implementation, the worker consumer, and all affected fixtures together. The required-member changes would otherwise fail the automatic workspace typecheck between tasks.

**Behavioral invariants:**

- `claims when only evidence advances and snapshots both source maxima`
- `claims when only SR theses advance and snapshots both source maxima`
- `returns idle when neither source has advanced`
- `coalesces simultaneous evidence and SR advances into one dual-pointer claim`
- `increments attempts only when reclaiming the same dual-pointer target`
- `completion requires the matching owner and both targets`
- `completion advances both pointers to the exact claimed targets`
- `transient release preserves both processed pointers and retries the same target pair`
- `does not ping-pong after completing a single-source advance`
- `propagates both claim targets through every worker terminal path`

- [ ] **Step 1: Write failing adapter transition tests first.** Add an `insertSrThesis` helper that inserts a minimal unique `sr_theses_v2` row for a requested symbol and returns its numeric ID; delete those test rows in `afterEach`. Update existing completion/retry calls to carry `targetSrThesesMaxId`, then add the exact invariant-named cases above. Assert claim values include:

  ```ts
  {
    targetReceiptId: expectedEvidenceMax,
    targetSrThesesMaxId: expectedSrMax,
    lastProcessedReceiptId: expectedProcessedEvidence,
    lastProcessedSrThesesMaxId: expectedProcessedSr
  }
  ```

  Cover empty-table maxima as `0`, custom `pair` as both the evidence `pair` filter and SR `symbol` filter, mismatched SR-target compare-and-set, completion of evidence-only and SR-only claims followed by an idle poll, and retry/reclaim of the same target pair.

- [ ] **Step 2: Write failing worker propagation tests.** Add `targetSrThesesMaxId` and `lastProcessedSrThesesMaxId` to every mocked claim. In the existing success, validation/permanent, exhausted-retry/permanent, transient, and lease-loss cases, assert `complete` or `releaseForRetry` receives the same `targetSrThesesMaxId`. Use the exact test name `propagates both claim targets through every worker terminal path` for the focused table-driven/parameterized coverage; do not split this 500-plus-line test file into a standalone test-only task.

- [ ] **Step 3: Run the focused tests and confirm the required fields/behavior fail.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Expected: FAIL because the port claim lacks SR fields and the adapter neither queries nor coordinates the SR maximum.

- [ ] **Step 4: Change the exported port shapes and their documentation.** Make these required additions:

  ```ts
  export interface PolicyInsightSynthesisClaim {
    cursorKey: string;
    targetReceiptId: number;
    targetSrThesesMaxId: number;
    attemptCount: number;
    leaseOwner: string;
    leaseExpiresAtUnixMs: number;
    lastProcessedReceiptId: number;
    lastProcessedSrThesesMaxId: number;
  }
  ```

  Add `targetSrThesesMaxId: number` to both `CompletePolicyInsightSynthesisInput` and `ReleaseForRetryInput`. Document `targetReceiptId` as the evidence-bundle component and the new property as the SR-thesis component. Do not add a new port method or alter `ClaimLatestPairEvidenceInput`.

- [ ] **Step 5: Implement the dual-pointer claim transaction.** Extend `CursorRow` with both snake-case SR fields. The cursor insert must initialize `last_processed_sr_theses_max_id` to `0`, and the locked select must read both SR fields. Query unfiltered maxima within the already scoped pair predicates and coalesce nulls to zero:

  ```sql
  SELECT COALESCE(MAX(id), 0) AS max_id
  FROM regime_engine.evidence_bundles
  WHERE pair = ${pair} AND scope_key = ${scopeKey}
  ```

  ```sql
  SELECT COALESCE(MAX(id), 0) AS max_id
  FROM regime_engine.sr_theses_v2
  WHERE symbol = ${pair}
  ```

  Return `null` only when both `targetReceiptId <= lastProcessedReceiptId` and `targetSrThesesMaxId <= lastProcessedSrThesesMaxId`. Treat the target pair as the retry identity:

  ```ts
  const isSameTarget =
    currentTargetReceiptId === targetReceiptId &&
    currentTargetSrThesesMaxId === targetSrThesesMaxId;
  const newAttemptCount = isSameTarget ? Number(cursor.attempt_count) + 1 : 1;
  ```

  Store both targets in the lease update and return both target and last-processed components in the claim. Keep next-attempt and unexpired-lease guards unchanged and before source queries.

- [ ] **Step 6: Implement two-component completion and retry compare-and-set.** Destructure `targetSrThesesMaxId` in both methods. `complete` must set both last-processed columns from the supplied targets, clear both target columns to NULL, clear lease fields and `next_attempt_at_unix_ms`, reset `attempt_count` to 0, and include both target values plus owner in its `WHERE`. `releaseForRetry` must leave both last-processed columns unchanged, PRESERVE both target columns (`target_receipt_id` and `target_sr_theses_max_id`), clear lease owner and expiry (`lease_owner = NULL`, `lease_expires_at_unix_ms = NULL`), schedule retry (`next_attempt_at_unix_ms = retryAtUnixMs`), and include both target values plus owner in its `WHERE`. Retain attempt reset on completion and attempt preservation on retry.

- [ ] **Step 7: Propagate the SR target through the worker.** Immediately capture `const targetSrThesesMaxId = claim.targetSrThesesMaxId` beside `receiptId`, and pass it to every `complete` and `releaseForRetry` call. Do not change synthesis inputs, result unions, or log field names.

- [ ] **Step 8: Run the focused transition and worker tests.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Expected: PASS, including evidence-only, SR-only, simultaneous, idle, retry, ownership-loss, and no-ping-pong cases.

- [ ] **Step 9: Check only the changed implementation/test files.**

  Run: `pnpm exec eslint src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Run: `pnpm exec prettier --check src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Expected: both commands exit 0. The orchestrated implementation loop also runs `pnpm -r typecheck` after this complete task, with port, adapter, worker, and test fixtures already synchronized.

- [ ] **Step 10: Commit the coordination unit.**

  ```bash
  git add src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts
  git commit -m "m84: trigger pair synthesis from evidence or sr theses"
  ```

## Task 3: Prove SR-only and evidence-only behavior end to end

**Files:**

- Modify: `src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts`
- Modify: `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`
- Reference only: `src/adapters/http/handlers/srLevelsV2Current.ts`
- Reference only: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`

Each existing test file is below the oversized test-update thresholds (the SR file has two cases; the synthesis file has six cases), so one acceptance-test task remains independently committable.

**Behavioral invariants:**

- `synthesizes and serves a pair insight from an SR-only trigger`
- `evidence-only synthesis remains independently triggerable`

- [ ] **Step 1: Convert the first SR worker E2E case into the failing SR-only acceptance test.** Seed candles and insert the SR brief, but do not POST an evidence bundle. Run the real trigger adapter and synthesis worker, then assert:
  - the cycle outcome is `succeeded`;
  - `GET /v1/insights/sol-usdc/current` returns 200 and contains support `90` and resistance `160`;
  - the persisted synthesis input contains the inserted SR thesis;
  - the cursor has `lastProcessedReceiptId === 0`, `lastProcessedSrThesesMaxId === insertedSrMaxId`, and both targets null;
  - an immediate second cycle returns `{ outcome: "idle" }` and does not add a second PolicyInsight row.

  Name the test exactly `synthesizes and serves a pair insight from an SR-only trigger`.

- [ ] **Step 2: Strengthen the existing evidence backfill E2E case.** Rename or add the exact case `evidence-only synthesis remains independently triggerable`. Assert the completed cursor has the evidence receipt ID, `lastProcessedSrThesesMaxId === 0`, both targets null, and an immediate second worker cycle is idle with only one insight persisted.

- [ ] **Step 3: Run the two focused E2E files.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`

  Expected: PASS and demonstrate both trigger sources independently, real synthesis persistence/current retrieval, and no redundant second cycle.

- [ ] **Step 4: Check only the changed E2E files.**

  Run: `pnpm exec eslint src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`

  Run: `pnpm exec prettier --check src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`

  Expected: both commands exit 0.

- [ ] **Step 5: Commit the acceptance coverage.**

  ```bash
  git add src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts
  git commit -m "m84: verify dual-source synthesis triggers end to end"
  ```

## Tests to add or update

- Migration tests for the SR pointer default, non-negative checks, active-lease backfill safety, and 3-state lease/target coherence.
- PostgreSQL adapter tests for evidence-only, SR-only, simultaneous, empty/idle, custom-pair, expired-lease, retry, completion, compare-and-set mismatch, and no-ping-pong transitions.
- Worker unit tests proving the SR target is forwarded on success, permanent failure, retry exhaustion, transient release, and lease-loss paths.
- PostgreSQL E2E coverage proving SR-only data triggers real pair synthesis and is visible from the current-insight endpoint.
- PostgreSQL E2E regression coverage proving evidence-only ingestion remains an independent trigger and both paths settle idle after completion.

## Validation commands

Run these after all implementation tasks complete; this is the validate phase, not a standalone implementation task:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate
pnpm run typecheck
pnpm run test
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
pnpm run lint
pnpm run build
git diff --check
```

Expected: every command exits 0. The migration reports no pending work on a second run; unit tests and PG tests pass; lint has zero warnings; build emits successfully; and `git diff --check` reports no whitespace errors.

## Risk areas

- **Migration safety:** Replacing named checks must preserve all existing predicates and safely backfill `target_sr_theses_max_id = 0` for existing active legacy leases before applying the new constraint. A generated table recreation, missing `DEFAULT 0`, or un-backfilled active lease could cause migration failure.
- **Lease coherence:** Claim/release/complete updates must preserve or clear target pairs consistently across idle, leased, and retry-cooldown states so the database check accepts valid transitions.
- **Compare-and-set races:** Owner plus both target components must be matched. Checking only the evidence target would allow a stale worker to complete a newer SR claim.
- **Retry identity:** Attempt count is keyed by the target pair. `releaseForRetry` must preserve `target_receipt_id` and `target_sr_theses_max_id` during retry cooldown so subsequent claims recognize the identical target pair and increment `attempt_count` rather than resetting it to 1.
- **Null maxima:** PostgreSQL `MAX` returns null on empty tables. Failing to normalize each independently breaks SR-only or evidence-only startup.
- **Source scoping:** Evidence uses `pair` plus `scope_key`; SR uses `symbol`. Accidentally omitting either predicate could trigger cross-pair or position-derived work.
- **High-water semantics:** Completion deliberately advances both pointers to the exact maxima captured during claim, not maxima re-read after synthesis. New rows arriving during synthesis must remain pending for the next poll.
- **Observability semantics:** The existing `receiptId` result/log remains the evidence component, so SR-only cycles may report zero. Changing that public/logging behavior is out of scope and should not be done implicitly.
- **Query performance:** `MAX(id)` on SR rows filtered by symbol should use the existing symbol-leading index sufficiently at current volume; unexpected query-plan regressions should be investigated before adding a new index.

## Stop conditions

Abort implementation and report the evidence instead of continuing if any of the following occurs:

- Drizzle generates a destructive table rebuild, drops data, or changes unrelated schema objects rather than an additive two-column migration plus constraint replacement.
- Production-compatible migration ordering cannot satisfy existing leased rows. In particular, if any deployed cursor can have an active legacy lease during migration, a deployment/lease-drain strategy must be agreed before enforcing the new coherence check.
- Repository inspection finds another implementation of `PolicyInsightSynthesisTriggerPort` or an external contract consumer that cannot be updated atomically in Task 2.
- `sr_theses_v2.symbol` does not contain the claim input's pair format or `id` is not a reliable monotonically increasing high-water mark.
- The acceptance test requires changing PolicyInsight synthesis logic, HTTP response contracts, or position-scoped synthesis; that indicates scope has expanded beyond this trigger fix.
- Focused PG failures reproduce on the unchanged baseline or require deleting/resetting shared database state outside the test-owned tables; do not mask environmental or migration-history failures with destructive cleanup.
