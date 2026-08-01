# Task Context: Task 3

Title: Prove SR-only and evidence-only behavior end to end
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-84
Repository: opsclawd/regime-engine
Branch: ai/issue-84
Start Commit: fe6cd852f09f3928795fb106d28125a71fbc74d7

## Task Requirements

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

## Repository Targets

### Expected Files
- src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts
- src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts

### Reference Files
- src/adapters/http/handlers/srLevelsV2Current.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts
["pnpm","exec","eslint","src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts","src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts"]
["pnpm","exec","prettier","--check","src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts","src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **SR-only end-to-end trigger**: Candles plus SR theses and no evidence bundle produce one current pair insight, settle both pointers, and leave the next poll idle. (Test: `synthesizes and serves a pair insight from an SR-only trigger`)
- **Evidence-only regression**: Evidence with no SR theses still produces one insight, advances only the evidence high-water mark, and leaves the next poll idle. (Test: `evidence-only synthesis remains independently triggerable`)

