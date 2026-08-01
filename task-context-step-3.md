# Task Context: Task 3

Title: Prove the Postgres-backed worker path end to end
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-82
Repository: opsclawd/regime-engine
Branch: ai/issue-82
Start Commit: cd8632d937da99fe51784b51216fc82d9df84458

## Task Requirements

**Files:**

- Create: `src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts`
- Modify: `package.json`
- Reference: `src/workers/policyInsight/runSynthesisCycle.ts`
- Reference: `src/workers/policyInsightSynthesisWorker.ts`
- Reference: `src/composition/buildStoreContext.ts`
- Reference: `src/composition/buildApplication.ts`
- Reference: `src/ledger/srThesesV2Store.ts`
- Reference: `src/ledger/pg/schema/policyInsights.ts`
- Reference: `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`

**Behavioral invariants (write these named tests first):**

1. `persists Postgres SR theses and derived levels through the pair synthesis worker`
   - Seed candles, a pair evidence bundle, and an `mco` v2 brief; run `runPolicyInsightSynthesisCycle`; verify `policy_insights.synthesis_input_json.srTheses` retains `source`/`briefId`, and `synthesis_output_json.levels` contains the eligible support and resistance.
2. `uses Postgres SR data when the SQLite ledger contains no SR rows`
   - Use an in-memory empty SQLite ledger while seeding only `sr_theses_v2`; synthesis still observes the v2 levels, proving the SR path does not depend on `/data/ledger.sqlite`.

- [ ] **Step 1: Add the focused Postgres integration fixture**

Follow the existing PG test's `describe.skipIf(!process.env.DATABASE_URL)` convention. Seed candles and evidence as that test does, then insert an SR brief through `ctx.srThesesV2Store!.insertBrief`:

```ts
await ctx.srThesesV2Store!.insertBrief({
  capturedAtUnixMs: FIXED_NOW - 5_000,
  request: {
    schemaVersion: "2.0",
    source: "mco",
    symbol: "SOL/USDC",
    brief: {
      briefId: "mco-sol-worker-e2e",
      sourceRecordedAtIso: new Date(FIXED_NOW - 10_000).toISOString(),
      summary: "Worker integration fixture"
    },
    theses: [
      {
        asset: "SOL",
        timeframe: "1d",
        bias: "bullish",
        setupType: null,
        supportLevels: ["90"],
        resistanceLevels: ["160"],
        entryZone: null,
        targets: [],
        invalidation: null,
        trigger: null,
        chartReference: null,
        sourceHandle: "morecryptoonline",
        sourceChannel: null,
        sourceKind: "youtube",
        sourceReliability: null,
        rawThesisText: null,
        collectedAt: null,
        publishedAt: null,
        sourceUrl: null,
        notes: null
      }
    ]
  }
});
```

Use an empty `:memory:` ledger in the runtime context, run the real pair synthesis cycle with `buildApplication(ctx).synthesizePolicyInsight!`, query the inserted `policy_insights` row, and assert both persisted input identity and output levels. Cleanup must delete `regime_engine.sr_theses_v2` in addition to the existing policy/evidence/candle rows.

- [ ] **Step 2: Register and run the focused PG test**

Append the exact new file path to `test:pg`; do not broaden the command with a new directory glob.

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts
pnpm exec eslint src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts
pnpm exec prettier --check src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts package.json
```

Expected: with the test database available, the test passes and shows `90`/`160` in the persisted policy output; ESLint and Prettier exit 0. The pair-scoped reducer currently uses its established fallback current price of 100 when no position is supplied, so the fixture deliberately places support below 100 and resistance above 100. If `DATABASE_URL` is intentionally absent, Vitest reports the suite skipped, which is not sufficient for task acceptance.

- [ ] **Step 3: Commit the worker integration proof**

```bash
git add src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts package.json
git commit -m "m82: verify worker SR synthesis from Postgres"
```

## Tests to add or update

- New pure reducer coverage: `src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts`.
- New focused orchestration/replay coverage: `src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts`.
- Mechanical dependency updates only in `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`; do not expand this 643-line file with new scenarios.
- Composition capability update: `src/composition/__tests__/policyInsightWiring.test.ts`.
- New real-Postgres worker proof: `src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts`, registered explicitly in `test:pg`.
- No output-contract snapshots or generated contract artifacts should change because no published `PolicyInsight` schema field is added.

## Validation commands

Task-local commands are listed in each task and target only that task's changed files. After all implementation tasks complete, the dedicated validate phase (not an implementation task) must run:

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run boundaries
pnpm run build
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
```

Expected: every command exits 0. The PG command must execute, not skip, the new worker test.

For production acceptance after the out-of-repo producer deployment, use the platform's approved SQL/observability tooling rather than adding a repository script:

```sql
SELECT count(*)
FROM regime_engine.sr_theses_v2
WHERE source = 'mco' AND symbol = 'SOL/USDC';
```

The result must be greater than zero. Trigger one pair-scoped synthesis and inspect the new `policy_insights.synthesis_input_json`/`synthesis_output_json` row for the same `briefId` and expected levels. This rollout check is external coordination, not a fourth implementation task.

## Risk areas

- **Replay identity migration:** Adding `srThesesHash` means the first synthesis after deployment creates a new insight even when market/evidence inputs are unchanged. This is intended, but consumers may observe a new current insight immediately.
- **Identity loss:** Mapping only `.theses` would discard `briefId`; the projection must retain it before hashing and persistence.
- **Nondeterministic array order:** `getCurrent` currently orders rows by database id. Sorting by the explicit identity tuple is required before both fingerprinting and envelope persistence.
- **Silent degradation:** Converting a rejected Postgres read into `[]` would persist a misleading no-SR insight. Only a real `null` response means no current brief.
- **Source hardcoding:** `mco` is intentionally fixed for this issue. Adding sources later needs an explicit precedence/deduplication design rather than appending them ad hoc.
- **Double counting:** Evidence and SR theses intentionally coexist. Opposing signals tighten via conflict; duplicate price levels deduplicate. Directional claims are distinct observations and therefore each count once.
- **Unvalidated numeric strings:** The v2 contract allows arbitrary strings in level arrays. Reducer parsing must reject non-finite/non-positive values and retain existing current-price side checks.
- **Capability mismatch:** A test-only `pg` context can currently omit `srThesesV2Store`; composition must report synthesis unavailable in that invalid topology instead of constructing a partially wired use case.
- **Operational dependency:** Repository code cannot populate production v2 data. The companion producer change is required before the end-user outcome can be verified.

## Stop conditions

- Stop and do not implement a direct `src/application/** -> src/ledger/**` import; use the planned read port so `.dependency-cruiser.cjs` remains satisfied.
- Stop if implementing the port would leave any concrete adapter or fake required by the typecheck gate for a later task; keep all method implementations in Task 2.
- Stop if the real producer's v2 payload cannot satisfy the existing strict v2 contract. Coordinate a companion contract-mapping change rather than weakening validation here.
- Stop if product requirements require multiple SR sources, source precedence, or freshness expiry; those materially change fingerprint and conflict semantics and need a revised design.
- Stop if the implementation requires reading v1 SQLite SR data or mounting the API service's `/data` volume into a separate worker for SR. That violates the selected Postgres topology.
- Stop if the new PG integration test cannot run because migrations or the test database are unavailable. Report the environment blocker; do not replace the test with mocks or claim the worker acceptance criterion passed.
- Stop if the published `policy-insight.v1` schema or generated wire-contract hash changes. The requested behavior fits existing level/reasoning fields and should not require a contract revision.
- Stop short of closing the overall issue if the companion producer has not populated `regime_engine.sr_theses_v2` in production, even when all repository implementation and tests pass.

## Repository Targets

### Expected Files
- src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts
- package.json

### Reference Files
- src/workers/policyInsight/runSynthesisCycle.ts
- src/workers/policyInsightSynthesisWorker.ts
- src/composition/buildStoreContext.ts
- src/composition/buildApplication.ts
- src/ledger/srThesesV2Store.ts
- src/ledger/pg/schema/policyInsights.ts
- src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts
pnpm exec eslint src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts
pnpm exec prettier --check src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts package.json
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **Worker persistence from v2 SR**: The real pair synthesis cycle persists canonical SR input identity and emits eligible SR levels in policy output. (Test: `persists Postgres SR theses and derived levels through the pair synthesis worker`)
- **No SQLite SR dependency**: An empty in-memory SQLite ledger does not prevent synthesis from reading seeded Postgres SR theses. (Test: `uses Postgres SR data when the SQLite ledger contains no SR rows`)

