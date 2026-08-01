<!-- plan-review-required -->

# Postgres-Backed Support/Resistance Policy Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every canonical `PolicyInsight` synthesis read the latest `mco` support/resistance brief from the Postgres-backed v2 store, include that input in replay identity, and combine its levels and directional bias with existing evidence-bundle signals deterministically.

**Architecture:** Keep `src/engine/` pure by projecting the v2 current-response contract into a synthesis-only value that carries `source` and `briefId`. Expose the existing Postgres store to the application layer through a read port, wire it in the composition root, sort the projected theses before hashing and persistence, and let the reducer merge SR-ledger inputs with (not replace) evidence-bundle inputs. The existing policy repository remains the only writer; this change adds no SQLite SR fallback and no new production write path.

**Tech Stack:** TypeScript, Node.js, Vitest, Drizzle/Postgres, canonical JSON and SHA-256 helpers, dependency-cruiser, pnpm.

---

## Goal

For pair-, whirlpool-, and position-scoped synthesis using `buildApplication`, load `SrThesesV2Store.getCurrent("SOL/USDC", "mco")`, persist the canonical SR projection in `synthesisInputJson`, include it in `synthesisInputHash`, and expose eligible numeric support/resistance levels plus bias-derived policy effects in the resulting `PolicyInsight`.

## Non-goals

- Do not modify `crypto-aggregator`; its producer must be changed in a companion issue to POST the real feed to `/v2/sr-levels`.
- Do not claim the production acceptance criterion `regime_engine.sr_theses_v2 > 0` until that companion deployment is complete and verified.
- Do not repair `sol-usdc-clmm-intelligence` or remove its evidence-bundle `supportResistance` path.
- Do not change the v1 SQLite `/v1/sr-levels` route, schema, writer, or volume topology.
- Do not change the v2 HTTP request/response contract, database schema, or `SrThesesV2Store.getCurrent` query semantics.
- Do not add multi-source lookup, source precedence, freshness expiry, retry behavior, or an environment variable for the primary source; this issue uses the explicitly approved source `mco`.
- Do not change the published `policy-insight.v1` output contract. Only the persisted synthesis input and the values already supported by that output contract change.

## Assumptions and decisions

- A synthesis-specific thesis must retain `source` and `briefId` because `SrThesisV2` alone contains neither. Define `PolicySynthesisSrThesis` as `SrThesisV2` plus those two identity fields; do not widen the public v2 HTTP contract.
- `source`, `briefId`, `asset`, and `sourceHandle` form the stable thesis ordering key. Nested producer arrays retain their ingested order; only the outer thesis list is reordered.
- A missing current `mco` brief is a valid empty input (`srTheses: []`). A database read failure is not equivalent to no data and must propagate before policy lookup or persistence so the worker can retry its existing cycle.
- SR-ledger and evidence-bundle direction votes share the existing bullish/bearish counters. Opposing votes therefore trigger the existing conflict tightening; same-direction votes corroborate one another. Numeric levels are unioned by the reducer's existing `Set` logic, so duplicates do not multiply output levels.
- Only finite, positive numeric strings are eligible for extraction. The existing downstream rules continue to reject supports above current price and resistances below current price, sort them nearest-first, deduplicate them, and cap each side at 16.
- New persisted envelopes always contain `srTheses`, including an empty array. The field remains optional on `PolicySynthesisEnvelope` so historical persisted inputs and direct reducer fixtures remain readable.
- The plan requires review because the new input changes canonical replay identity and the contents of records written by the existing policy repository.

## Affected files

| Path                                                                          | Responsibility                      | Planned change                                                                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/engine/policy/synthesizePolicyInsight.ts`                                | Pure policy envelope and reducer    | Add the synthesis SR projection and merge levels, bias, and identifiers into shared evaluation.                |
| `src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts`        | Focused reducer invariants          | New tests for level eligibility, coexistence, conflicts, identifiers, and determinism.                         |
| `src/application/ports/srThesesReadPort.ts`                                   | Application-facing SR read boundary | New one-method read port returning the existing v2 current-response type.                                      |
| `src/ledger/srThesesV2Store.ts`                                               | Postgres v2 SR store                | Declare conformance to the read port without changing `getCurrent` behavior.                                   |
| `src/application/use-cases/synthesizePolicyInsightUseCase.ts`                 | Synthesis orchestration             | Read `mco`, canonicalize the current brief, hash it, place it in the envelope, and fail closed on read errors. |
| `src/application/use-cases/policyInsightFingerprints.ts`                      | Canonical replay identity           | Add canonical SR content to `synthesisInputHash`.                                                              |
| `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`  | Existing orchestration invariants   | Supply the required empty SR reader to existing fixtures; no existing assertions change.                       |
| `src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts` | Focused SR orchestration invariants | New tests for lookup arguments, sorting, null/error behavior, hashes, replay, and persisted input.             |
| `src/composition/buildApplication.ts`                                         | Runtime dependency wiring           | Require the Postgres SR store when constructing synthesis and inject it through the port.                      |
| `src/composition/__tests__/policyInsightWiring.test.ts`                       | Composition capability tests        | Prove synthesis is exposed only when the SR reader is present with the other Postgres dependencies.            |
| `src/workers/__tests__/policyInsightSrTheses.e2e.pg.test.ts`                  | Postgres worker integration         | New end-to-end test that seeds v2 SR, runs pair synthesis, and inspects the persisted input/output.            |
| `package.json`                                                                | Test command registration           | Add the new PG end-to-end file to `test:pg`.                                                                   |

## Task 1: Merge canonical SR theses in the pure policy reducer

**Files:**

- Modify: `src/engine/policy/synthesizePolicyInsight.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts`
- Reference: `src/contract/v2/srLevels.ts`
- Reference: `src/engine/policy/__tests__/policyFixtures.ts`
- Reference: `src/engine/policy/reasoning.ts`

**Behavioral invariants (write these named tests first):**

1. `adds valid SR thesis levels and identities without replacing evidence-derived inputs`
   - Given valid SR-ledger supports/resistances and an evidence-derived numeric level, the output contains the eligible union and reasoning includes the SR `briefId` exactly once even when the brief has multiple theses; neither source removes the other.
2. `combines SR and evidence bias votes and treats opposition as conflict`
   - Given a bullish SR thesis and bearish contextual evidence, the existing conflict policy applies: risk is elevated and confidence is capped low. Given aligned votes, the normal directional vote behavior applies once, without bypassing higher-precedence locks.
3. `ignores non-finite non-positive and side-ineligible SR level strings`
   - `NaN`, infinities, zero, negatives, supports above current price, and resistances below current price do not appear in output levels; valid supports and resistances do.
4. `deduplicates sorts and caps SR levels with existing output rules`
   - Duplicate strings/numeric equivalents collapse, supports sort descending, resistances sort ascending, and each output side contains at most 16 values.
5. `produces byte-identical output for the same canonical SR thesis input`
   - Repeated reducer calls with the same envelope produce byte-identical JSON.
6. `preserves legacy reducer behavior when SR theses are absent`
   - Omitting `srTheses` is equivalent to passing `srTheses: []`, preserving historical input compatibility.

- [ ] **Step 1: Create the focused failing reducer tests**

Build envelopes from `calmChopMarket` and `makeMockEvidenceSummary`. Use a synthesis thesis with explicit identity and string levels:

```ts
const srThesis: PolicySynthesisSrThesis = {
  source: "mco",
  briefId: "mco-sol-2026-07-30",
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: null,
  supportLevels: ["95", "90", "0", "not-a-number"],
  resistanceLevels: ["105", "110"],
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
};
```

Run:

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
```

Expected: FAIL because `PolicySynthesisSrThesis` and `PolicySynthesisEnvelope.srTheses` do not exist and the reducer ignores the values.

- [ ] **Step 2: Add the synthesis-only SR type and envelope field**

Import `SrThesisV2` from the contract and add the identity-preserving type without changing the v2 wire contract:

```ts
export interface PolicySynthesisSrThesis extends SrThesisV2 {
  readonly source: string;
  readonly briefId: string;
}

export interface PolicySynthesisEnvelope {
  // existing fields stay unchanged
  readonly srTheses?: readonly PolicySynthesisSrThesis[];
}
```

- [ ] **Step 3: Merge SR values into shared rule evaluation**

After evidence-derived feature levels are collected and before conflict evaluation, process `envelope.srTheses ?? []`. Parse price strings with `Number`, accept only `Number.isFinite(value) && value > 0`, increment the existing counters only for exact `bullish`/`bearish` bias values, and add `briefId` to `boundedIdentifiers`:

```ts
for (const thesis of envelope.srTheses ?? []) {
  for (const raw of thesis.supportLevels) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) extractedSupport.push(value);
  }
  for (const raw of thesis.resistanceLevels) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) extractedResistance.push(value);
  }
  if (thesis.bias === "bullish") bullishCount += 1;
  if (thesis.bias === "bearish") bearishCount += 1;
}
```

Add each SR brief identifier once, preserving first occurrence in the canonical thesis order:

```ts
const seenSrBriefIds = new Set<string>();
for (const thesis of envelope.srTheses ?? []) {
  if (!seenSrBriefIds.has(thesis.briefId)) {
    seenSrBriefIds.add(thesis.briefId);
    boundedIdentifiers.push(thesis.briefId);
  }
}
```

Do not add a new action, reason code, warning code, or output field. Reuse the current vote/conflict rules, level sets, ordering, and caps.

- [ ] **Step 4: Run the scoped reducer checks**

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
pnpm exec eslint src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
pnpm exec prettier --check src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
```

Expected: the focused test file passes; ESLint and Prettier exit 0.

- [ ] **Step 5: Commit the reducer slice**

```bash
git add src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
git commit -m "m82: merge SR theses into policy synthesis"
```

## Task 2: Read, canonicalize, hash, and wire Postgres SR theses

**Files:**

- Create: `src/application/ports/srThesesReadPort.ts`
- Modify: `src/ledger/srThesesV2Store.ts`
- Modify: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/policyInsightFingerprints.ts`
- Modify: `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- Create: `src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts`
- Modify: `src/composition/buildApplication.ts`
- Modify: `src/composition/__tests__/policyInsightWiring.test.ts`
- Reference: `src/contract/v2/srLevels.ts`
- Reference: `src/composition/buildStoreContext.ts`
- Reference: `src/engine/policy/synthesizePolicyInsight.ts`
- Reference: `.dependency-cruiser.cjs`

This task intentionally contains the new read-port method, the concrete Postgres implementation declaration, and the composition update together. Do not split them: the workspace-wide typecheck gate must see a complete vertical slice.

**Behavioral invariants (write these named tests first):**

1. `queries the primary mco SR brief for SOL USDC before fingerprint lookup`
   - The use case calls `getCurrent("SOL/USDC", "mco")` exactly once before `findBySynthesisInputHash` and persists the returned brief projection.
2. `canonicalizes SR theses by source brief asset and source handle`
   - Two current responses with identical theses in different database-return order produce the same persisted `srTheses` order and the same synthesis input hash.
3. `treats a missing current SR brief as a canonical empty input`
   - A `null` read yields `srTheses: []`, still synthesizes, and includes the empty input in the fingerprint.
4. `changes synthesis replay identity when SR thesis content changes`
   - With market, plan, and evidence unchanged, changing levels, bias, identity, or other thesis content changes `synthesisInputHash` and creates distinct history.
5. `exact SR replay returns the stored canonical winner`
   - The same canonical SR input reuses the existing policy record, just like existing market/position/evidence replay.
6. `does not persist or replay when the SR store read fails`
   - A rejected `getCurrent` promise propagates; neither repository read nor insert is called, preventing a database outage from being silently interpreted as no SR data.
7. `requires the Postgres SR reader before exposing synthesis capability`
   - `buildApplication` returns `synthesizePolicyInsight: null` when Postgres/evidence are present but `srThesesV2Store` is absent, and returns a function when all are present.

- [ ] **Step 1: Add failing focused use-case and wiring tests**

Create a small fake `SrThesesReadPort` and repository in the new test file. Assert call order with a shared event array, inspect `repository.insertCalls[0].synthesisInputJson.srTheses`, and compare `insightId`/`synthesisInputHash` across reordered and changed briefs. Update the existing 643-line use-case test only mechanically by injecting an empty reader into every factory call:

```ts
const emptySrThesesReadPort = (): SrThesesReadPort => ({
  getCurrent: vi.fn().mockResolvedValue(null)
});

const useCase = createSynthesizePolicyInsightUseCase({
  getCurrentRegime,
  selectEvidence,
  srThesesReadPort: emptySrThesesReadPort(),
  repository,
  clock,
  ruleset: SOL_USDC_POLICY_V1
});
```

In `policyInsightWiring.test.ts`, use a structural fake with `getCurrent: vi.fn().mockResolvedValue(null)` for the positive case and retain `null` for the negative case.

Run:

```bash
pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/composition/__tests__/policyInsightWiring.test.ts
```

Expected: FAIL until the port, dependency, fingerprint, and composition changes exist.

- [ ] **Step 2: Add the application read port and declare the adapter implementation**

Create the boundary type using the existing contract response:

```ts
import type { SrLevelsV2CurrentResponse } from "../../contract/v2/srLevels.js";

export interface SrThesesReadPort {
  getCurrent(symbol: string, source: string): Promise<SrLevelsV2CurrentResponse | null>;
}
```

Update `SrThesesV2Store` to `implements SrThesesReadPort` and import the port type. Do not alter its method body, SQL ordering, return contract, or error behavior.

- [ ] **Step 3: Canonically project current-response identity into synthesis theses**

Add the required `srThesesReadPort` member to `SynthesizePolicyInsightUseCaseDeps`. In the use-case module, add a private projection that enriches every thesis and sorts a copied array without mutating the store response:

```ts
const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const projectSrTheses = (current: SrLevelsV2CurrentResponse | null): PolicySynthesisSrThesis[] =>
  current === null
    ? []
    : current.theses
        .map((thesis) => ({
          ...thesis,
          source: current.source,
          briefId: current.brief.briefId
        }))
        .sort(
          (left, right) =>
            compareText(left.source, right.source) ||
            compareText(left.briefId, right.briefId) ||
            compareText(left.asset, right.asset) ||
            compareText(left.sourceHandle, right.sourceHandle)
        );
```

After evidence selection/time/hash validation and before computing fingerprints or querying the policy repository, call:

```ts
const srTheses = projectSrTheses(await deps.srThesesReadPort.getCurrent("SOL/USDC", "mco"));
```

Do not catch this read as an empty response. Pass `srTheses` to both fingerprint computation and the persisted envelope.

- [ ] **Step 4: Include canonical SR content in replay identity**

Add a required `srTheses: readonly PolicySynthesisSrThesis[]` member to `FingerprintsInput`. Compute a component hash and add it to the canonical `inputForHash` object:

```ts
const srThesesHash = sha256Hex(toCanonicalJson(input.srTheses));

const inputForHash = {
  rulesetVersion: input.rulesetVersion,
  pair: input.pair,
  scopeKey,
  marketHash,
  positionHash,
  selectionHash,
  srThesesHash
};
```

No database column or `PolicyInsightFingerprints` return member is needed: `synthesisInputHash` remains the persisted aggregate identity.

- [ ] **Step 5: Wire the port and preserve capability truthfulness**

In `buildApplication`, require `ctx.srThesesV2Store` in the same condition that currently requires the policy and evidence repositories, then pass it as `srThesesReadPort`. Because `buildStoreContext` constructs that store from the same `Db`, both the HTTP lifecycle worker and standalone worker receive a Postgres-backed reader; no SQLite `/data` path is consulted for SR.

```ts
const synthesizePolicyInsight =
  policyInsightRepository && selectEvidenceForSynthesis && ctx.srThesesV2Store
    ? createSynthesizePolicyInsightUseCase({
        getCurrentRegime,
        selectEvidence: selectEvidenceForSynthesis,
        srThesesReadPort: ctx.srThesesV2Store,
        repository: policyInsightRepository,
        clock,
        ruleset: SOL_USDC_POLICY_V1
      })
    : null;
```

- [ ] **Step 6: Run the scoped vertical-slice checks**

```bash
pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/composition/__tests__/policyInsightWiring.test.ts
pnpm exec eslint src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
pnpm exec prettier --check src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
```

Expected: all three test files pass; ESLint and Prettier exit 0. The automatic implementation gate then runs `pnpm -r typecheck` workspace-wide with the port and adapter already aligned.

- [ ] **Step 7: Commit the vertical slice**

```bash
git add src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
git commit -m "m82: read Postgres SR theses during policy synthesis"
```

## Task 3: Prove the Postgres-backed worker path end to end

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
