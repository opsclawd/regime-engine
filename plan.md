<!-- plan-review-required -->

# Evidence Selection and Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, advisory-only evidence selector that scores the latest exact-scope EvidenceBundle records, preserves complete selection lineage, reports conflict and missing coverage, and degrades explicitly when research is absent.

**Architecture:** Add an environment-free policy module and pure selector under `src/engine/evidence/`, then expose the selector through a clock-capturing application use case backed by the existing `EvidenceBundleRepositoryPort.getLatest` method. Wire that use case beside the existing evidence use cases only when PostgreSQL evidence storage exists; do not add an HTTP route or insert evidence into regime/plan generation.

**Tech Stack:** TypeScript 5.8, Node.js 22, Vitest 3, existing canonical JSON helper, existing hexagonal application/port/composition structure.

---

**Goal details**

- Select and score deterministic features, contextual claims, and a lineage-supported research brief from the latest record for every source in one exact scope.
- Use exact integer basis-point arithmetic and deterministic ordering so record permutations produce deep-equal and byte-identical canonical output.
- Emit one terminal decision for every bundle/candidate considered, retain selected and audit-only source-reference lineage, and make every inclusion or exclusion explainable by stable codes.
- Return `authority: "ADVISORY_ONLY"` and `DEGRADED_NO_RESEARCH` when contextual research is absent, leaving deterministic market state and hard guards independent.

**Non-goals**

- Do not add or alter evidence HTTP routes, OpenAPI, external ingest, contract schemas/generated contract types, canonical evidence hashing, PostgreSQL schema/migrations, or append/replay behavior.
- Do not add a repository-port method or change `getLatest`; selection consumes its existing fresh/stale/expired current-per-source view without history fallback or retry.
- Do not persist selection results or mutate accepted evidence rows/`selectionLineage`.
- Do not produce `PolicyInsight`, recommendations, actions, allocations, `allowClmm`, guard overrides, or execution requests.
- Do not change candle freshness, market-regime classification, plan generation, deterministic hard guards, or any on-chain behavior.
- Do not invent a reviewed production `sourceId`; the shipped v1 override map remains empty until a separately reviewed identity is configured with a policy-version bump.

**Affected files (repository-relative full paths)**

- Create `src/engine/evidence/selectionPolicy.ts` — policy types, stable codes, v1 values, exact source-key construction, and fail-fast policy validation.
- Create `src/engine/evidence/selectEvidence.ts` — public selection types and pure scoring/selection kernel.
- Create `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts` — small, contract-valid record/item builders shared by selector tests.
- Create `src/engine/evidence/__tests__/selectionPolicy.test.ts` — policy constants, key safety, immutability, and validation tests.
- Create `src/engine/evidence/__tests__/selectEvidence.scoring.test.ts` — bundle/item lifecycle, source/provenance, and exact-score tests.
- Create `src/engine/evidence/__tests__/selectEvidence.lineage.test.ts` — family cap, dependency closure, brief, qualified identity, and source-reference lineage tests.
- Create `src/engine/evidence/__tests__/selectEvidence.summary.test.ts` — conflict, coverage/mode, ordering, permutation, and decision-integrity tests.
- Create `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts` — one-clock/one-read orchestration over the pure selector.
- Create `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts` — repository-call, clock, degraded-success, and error-propagation tests.
- Modify `src/composition/buildApplication.ts` — nullable use-case exposure using the existing PostgreSQL evidence repository.
- Create `src/composition/__tests__/evidenceSelectionWiring.test.ts` — configured/unconfigured composition and deterministic-path isolation tests.

**Cross-task behavioral invariants**

- Record order, object insertion order, `Map`/`Set` iteration order, and publisher array order must not affect selected output; every emitted array has an explicit comparator.
- Lifecycle boundaries are inclusive: `selectedAt == freshUntil` is fresh and `selectedAt == expiresAt` remains usable; only a strictly later instant is stale/expired respectively.
- Candidate decisions move monotonically from evaluation to exactly one terminal `INCLUDED` or `EXCLUDED` state. Family-cap exclusion and dependency exclusion are terminal; the selector never backfills a cap slot after dependency closure.
- A research brief is evaluated only after all non-brief decisions are terminal and cannot survive if any cited same-bundle item is excluded.
- No evidence result contains action, allocation, CLMM permission, deterministic guard, or hard-guard override fields; missing evidence changes only evidence mode/warnings.

## Task 1: Define and validate the versioned selection policy

**Files:**

- Create: `src/engine/evidence/selectionPolicy.ts`
- Create: `src/engine/evidence/__tests__/selectionPolicy.test.ts`

**Exported API surface:** Add `EvidenceSelectionPolicy`, `ProvenanceClass`, `EvidenceSelectionReasonCode`, `EvidenceSelectionWarningCode`, `EVIDENCE_SELECTION_POLICY_VERSION`, `EVIDENCE_SELECTION_POLICY_V1`, `evidenceSourceQualityKey`, and `validateEvidenceSelectionPolicy`. These declarations and their tests belong in this task; no port or adapter changes are involved.

**Behavioral invariants to write as tests first:**

- `ships the conservative immutable v1 policy values`: version is `evidence-selection.v1`, minimum score is `2_500`, stale weight is `5_000`, family cap is `16`, default source quality is `5_000`, provenance is calculator `10_000`, derived `9_000`, collected `8_000`, human-authored `7_000`, and the reviewed-source map is empty.
- `qualifies source quality keys without publisher/source collisions`: publisher and source ID are encoded with length prefixes (for example `${publisher.length}:${publisher}${sourceId.length}:${sourceId}`), so delimiter-bearing identities cannot alias.
- `rejects non-finite or out-of-range policy basis points`: every bps field and source override must be a finite integer in `[0, 10_000]`.
- `rejects zero or non-integer family limits and blank versions`: `maxSelectedPerFamily` must be a positive integer and `version` must contain non-whitespace text.
- `does not permit mutation of the shipped policy`: nested maps are copied/frozen (or otherwise exposed read-only without a mutable backing object) so one caller cannot alter later selections.

- [ ] **Step 1: Write the failing policy tests**

  Create `selectionPolicy.test.ts` with the exact test names above. For collision safety, compare keys for identities such as `("ab", "c")` and `("a", "bc")`; for validation, table-drive every scalar boundary (`-1`, `10_001`, `1.5`, `NaN`, `Infinity`) plus an invalid per-source override. Assert `validateEvidenceSelectionPolicy` throws `TypeError` with a field-qualified message.

- [ ] **Step 2: Run the focused tests and observe the missing module failure**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectionPolicy.test.ts`

  Expected: FAIL because `selectionPolicy.ts` and its exports do not exist.

- [ ] **Step 3: Implement policy types, constants, keys, and validation**

  Use integer bps throughout and define the public shape explicitly:

  ```ts
  export type ProvenanceClass =
    | "deterministic_calculator"
    | "derived"
    | "collected"
    | "human_authored";

  export interface EvidenceSelectionPolicy {
    readonly version: string;
    readonly minimumEffectiveScoreBps: number;
    readonly staleWeightBps: number;
    readonly maxSelectedPerFamily: number;
    readonly defaultSourceQualityBps: number;
    readonly sourceQualityBps: Readonly<Record<string, number>>;
    readonly provenanceQualityBps: Readonly<Record<ProvenanceClass, number>>;
  }

  export const EVIDENCE_SELECTION_POLICY_VERSION = "evidence-selection.v1" as const;
  ```

  Include stable reason-code unions for record mismatch, bundle expiry/disablement, feature unavailable/invalid/dependency failure, claim expiry, score threshold, family cap, brief unavailable/citation failure, and fresh/stale inclusion. Include warning-code unions for stale input, missing/rejected/conflicted families, and no selected research. `validateEvidenceSelectionPolicy` must validate a copied policy before selection starts and return an immutable normalized policy; do not consult `process.env`.

- [ ] **Step 4: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectionPolicy.test.ts`

  Expected: PASS with all five named invariants.

  Run: `pnpm exec eslint src/engine/evidence/selectionPolicy.ts src/engine/evidence/__tests__/selectionPolicy.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The implement loop also runs its automatic workspace `pnpm -r typecheck` gate.

- [ ] **Step 5: Commit the independently usable policy unit**

  ```bash
  git add src/engine/evidence/selectionPolicy.ts src/engine/evidence/__tests__/selectionPolicy.test.ts
  git commit -m "m60: define evidence selection policy"
  ```

## Task 2: Implement exact bundle and item scoring with terminal decisions

**Files:**

- Create: `src/engine/evidence/selectEvidence.ts`
- Create: `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts`
- Create: `src/engine/evidence/__tests__/selectEvidence.scoring.test.ts`

**Exported API surface:** Add `SelectEvidenceInput`, `SelectedEvidenceSummary` and its named nested result/decision/lineage types, and `selectEvidence`. Keep the selector input limited to records, one instant, one exact scope, and policy; do not accept market state, plan state, or guards.

**Behavioral invariants to write as tests first:**

- `selects fresh high-confidence features and claims with exact component scores`: exact formula uses confidence × source quality × provenance quality × minimum freshness divided by `10_000^3`, floors once with `bigint`, and returns a safe integer.
- `downweights a stale bundle once and emits STALE_EVIDENCE_DOWNWEIGHTED`: stale bundle and stale feature use `min(bundle,item)` rather than multiplying stale twice.
- `uses inclusive feature freshness and claim expiry boundaries`: equality is usable; strictly past feature freshness is stale and strictly past claim expiry is `CLAIM_EXPIRED`.
- `excludes expired bundles and records every contained candidate as BUNDLE_EXPIRED`: expired evidence never reaches scoring or inclusion.
- `excludes unavailable and invalid features with distinct terminal reasons`: unavailable and invalid candidates retain audit lineage but never score as selected.
- `applies exact-source overrides before the conservative default and honors zero as disabled`: source keys are publisher+source qualified; publisher assessment cannot promote either path.
- `applies calculator derived collected and human-authored provenance weights exactly`: deterministic features use calculator weight and each claim method uses its configured factor.
- `excludes scores below threshold while retaining score components`: equality with the threshold is eligible; only lower scores are excluded.
- `isolates scope and lifecycle metadata mismatches without corrupting valid peers`: mismatched records and their contents receive record mismatch reasons while valid records continue.
- `rejects invalid input before returning partial output`: non-finite/non-integer/negative `selectedAtUnixMs`, invalid policy, or an impossible final score throws synchronously from the pure call.

- [ ] **Step 1: Create contract-valid fixture builders and failing scoring tests**

  Builders must default to a fixed pair scope, source identity, canonical timestamps, at least one deterministic feature, at least one source reference, and internally consistent assessment/provenance. Expose overrides for source, lifecycle, feature/claim family, timestamps, confidence, provenance, brief, and references. Validate builder output with `parseEvidenceBundleV1` so tests cannot exercise impossible contract shapes accidentally.

  In the exact arithmetic test, use factors that expose premature division/float rounding and assert the formula through a helper equivalent to:

  ```ts
  const expected = Number(
    (BigInt(confidenceBps) * BigInt(sourceBps) * BigInt(provenanceBps) * BigInt(freshnessBps)) /
      10_000n ** 3n
  );
  ```

- [ ] **Step 2: Run the scoring test file and observe the missing selector failure**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.scoring.test.ts`

  Expected: FAIL because `selectEvidence` and result types do not exist.

- [ ] **Step 3: Define the result model and selection stages**

  Define qualified candidate identity as `<evidenceHash>/<kind>/<localId>` where kind is `deterministic_feature`, `contextual_claim`, or `research_brief`; use the literal local ID `<unavailable>` for a null brief decision. Each selected item and decision includes bundle hash/row/run/correlation/source identity, original item, raw confidence, source/provenance/freshness components, final score when calculable, source-reference IDs, status, and stable reasons.

  The top-level shape must contain exactly the advisory selection concerns:

  ```ts
  export interface SelectEvidenceInput {
    readonly records: readonly EvidenceBundleRecord[];
    readonly selectedAtUnixMs: number;
    readonly scope: Scope;
    readonly policy: EvidenceSelectionPolicy;
  }

  export interface SelectedEvidenceSummary {
    readonly selectionPolicyVersion: string;
    readonly selectedAtUnixMs: number;
    readonly pair: "SOL/USDC";
    readonly scope: Scope;
    readonly authority: "ADVISORY_ONLY";
    readonly mode: "FULL" | "PARTIAL" | "DEGRADED_NO_RESEARCH";
    readonly selected: {
      readonly deterministicFeatures: readonly SelectedDeterministicFeature[];
      readonly contextualEvidence: SelectedContextualFamilies;
      readonly researchBrief: SelectedResearchBrief | null;
    };
    readonly familyCoverage: FamilyCoverageSummary;
    readonly deterministicEvidenceCoverage: DeterministicCoverageSummary;
    readonly conflicts: readonly ConflictSummary[];
    readonly warnings: readonly SelectionWarning[];
    readonly sourceReferences: readonly SelectedSourceReference[];
    readonly bundles: readonly BundleSelectionLineage[];
    readonly decisions: readonly EvidenceSelectionDecision[];
  }
  ```

  Do not expose recommendation/action/allocation/CLMM/guard fields. Initialize summary fields through deterministic helper functions rather than mutable output shared between invocations.

- [ ] **Step 4: Implement exact lifecycle and score evaluation**

  Validate input first. Recompute lifecycle from bundle timestamps with `selectedAt <= freshUntil` → `FRESH`, else `selectedAt <= expiresAt` → `STALE`, else `EXPIRED`; reject record metadata disagreement instead of repairing it. Compare scope structurally through the existing deterministic `evidenceScopeKey` behavior (or an inner-layer equivalent that does not import the application port).

  Sort records explicitly by publisher, source ID, `asOf`, received time, row ID, then evidence hash using a comparator based on `<`, `>`, and numeric comparison (never locale-sensitive comparison). Resolve source quality by exact key then default. Evaluate bundle eligibility, feature status/freshness, claim expiry/provenance, and threshold. Use one `bigint` numerator and one denominator; assert the result lies in `[0, 10_000]` before converting to number.

- [ ] **Step 5: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.scoring.test.ts`

  Expected: PASS with all ten scoring/lifecycle invariants.

  Run: `pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.scoring.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate must also pass before commit.

- [ ] **Step 6: Commit the scoring kernel**

  ```bash
  git add src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.scoring.test.ts
  git commit -m "m60: score evidence candidates exactly"
  ```

## Task 3: Enforce family bounds, feature closure, brief support, and reference lineage

**Files:**

- Modify: `src/engine/evidence/selectEvidence.ts` (candidate ranking, dependency fixed point, brief evaluation, reference union)
- Modify: `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts` (only builders needed for multi-item lineage cases)
- Create: `src/engine/evidence/__tests__/selectEvidence.lineage.test.ts`

**Behavioral invariants to write as tests first:**

- `ranks each non-brief family by every documented tie-break and excludes overflow as FAMILY_SELECTION_LIMIT`: compare score descending, bundle `asOf` descending, item `observedAt` descending with null last, publisher/source/local ID/hash ascending.
- `excludes feature dependants to a fixed point and never backfills capped slots`: if A depends on excluded B and C depends on A, B is terminal first, then A and C become `FEATURE_DEPENDENCY_EXCLUDED`; a rank-17 candidate does not replace them.
- `keeps source-reference lineage valid when feature lineage resolves directly to a reference`: local lineage IDs are resolved within the same qualified bundle only.
- `keeps duplicate local evidence and reference IDs distinct across bundle hashes`: maps and decision joins always use qualified identity, never raw local ID globally.
- `records RESEARCH_BRIEF_UNAVAILABLE for a null brief`: the synthetic unavailable decision is terminal and no brief is selected.
- `selects a fully supported brief at the minimum of assessment and cited-average score`: cited average is floor(sum/count), brief score is `min(overallConfidenceBps, average)`, and reference lineage is the cited-item union.
- `excludes a brief when any cited item was rejected capped or dependency-excluded`: terminal reason is `BRIEF_REFERENCES_EXCLUDED_EVIDENCE` with canonically ordered excluded IDs; no partial brief support is allowed.
- `excludes an under-threshold otherwise-supported brief with its computed score`: the common minimum threshold applies after support resolution.
- `marks references selected lineage audit only or both and preserves originating bundle identity`: the union includes references reached from selected items and excluded decisions, with deterministic role flags/order.

- [ ] **Step 1: Write the failing cap/lineage/brief/reference tests**

  Build small fixtures for each state transition. Use a test-only policy with cap `1` to prove ranking without creating 17 claims. For fixed-point closure, explicitly assert the terminal reason and dependency list for each feature and assert no duplicate decision IDs. For references, include the same `referenceId` under two evidence hashes and assert two qualified output entries.

- [ ] **Step 2: Run the focused lineage tests and observe the missing behavior**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.lineage.test.ts`

  Expected: FAIL on cap ordering, dependency closure, brief, and/or reference-union assertions.

- [ ] **Step 3: Implement preliminary family decisions and monotonic dependency closure**

  Group only preliminarily eligible candidates by their declared family. Sort a copied array with the full comparator, mark the first `maxSelectedPerFamily` as preliminary inclusion, and terminally exclude the rest. Then repeatedly scan deterministic features in canonical qualified-ID order until a pass makes no changes; transition a preliminary feature to terminal exclusion when any same-bundle feature dependency is terminally excluded. Source-reference IDs satisfy lineage but are not feature dependencies. Never transition an excluded decision back to included and never refill a family slot.

- [ ] **Step 4: Evaluate briefs after non-brief decisions are terminal**

  Resolve every `sourceEvidenceId` against same-bundle feature/claim identities. If any does not have a terminal included decision, exclude the brief and list those local IDs in explicit string order. Otherwise calculate the floor average exactly with integer sum/division, cap it by publisher overall confidence, apply the common threshold, and inherit the deterministic union of cited selected-item references. A brief does not contribute independent facts or references.

- [ ] **Step 5: Build the qualified source-reference union**

  Resolve every referenced local ID within its bundle. Emit one entry per `<evidenceHash>/<referenceId>` with origin metadata and booleans/roles for selected lineage and audit-only use. A reference reached by both selected and excluded decisions reports both; unreferenced bundle references do not appear. Sort by bundle/source identity and local reference ID with explicit comparators.

- [ ] **Step 6: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.lineage.test.ts`

  Expected: PASS with all nine lineage invariants. Earlier scoring behavior is covered again by the dedicated validation phase.

  Run: `pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.lineage.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate must pass.

- [ ] **Step 7: Commit the terminal-decision pipeline**

  ```bash
  git add src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.lineage.test.ts
  git commit -m "m60: preserve evidence selection lineage"
  ```

## Task 4: Derive conflict, coverage, warnings, and canonical output

**Files:**

- Modify: `src/engine/evidence/selectEvidence.ts` (summaries and final canonical sorting only)
- Modify: `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts` (only conflict/permutation helpers)
- Create: `src/engine/evidence/__tests__/selectEvidence.summary.test.ts`

**Behavioral invariants to write as tests first:**

- `preserves bullish and bearish claims and computes conflict from effective scores`: both sides remain selected, direction totals use effective scores, consensus is `floor(abs(bullish-bearish)*10_000/(bullish+bearish))`, and the stable family conflict warning is emitted.
- `does not create conflict from neutral mixed or unknown claims`: those buckets are reported separately and do not enter directional consensus.
- `derives AVAILABLE CONFLICTED REJECTED and MISSING from terminal decisions`: publisher-declared coverage/quality is retained only in bundle lineage and never controls selected coverage.
- `returns FULL only for all five contextual families plus a brief with no conflict`: any missing/rejected/conflicted family or missing brief prevents full mode.
- `returns PARTIAL when at least one contextual claim or brief survives`: selected deterministic features alone do not cause partial mode.
- `returns DEGRADED_NO_RESEARCH for empty deterministic-only expired and fully-rejected inputs`: output is successful, advisory-only, and includes ordered missing/rejected/no-research warnings as applicable.
- `emits warnings in canonical family and code order without duplicates`: stale, conflict, missing/rejected, and no-research codes have stable ordering independent of discovery order.
- `produces deep-equal and byte-identical canonical JSON for every record permutation`: compare `toCanonicalJson` results for reversed and shuffled records/items.
- `gives every candidate exactly one terminal decision and every selected item one matching INCLUDED decision`: expired/rejected contents remain auditable and no terminal state is duplicated.
- `never exposes policy authority fields`: recursively assert the result has no keys named `action`, `allocation`, `allowClmm`, `guard`, or `override` and always has literal `ADVISORY_ONLY`.

- [ ] **Step 1: Write the failing summary and permutation tests**

  The conflict fixture must combine fresh and stale claims from different source IDs so totals prove weighting rather than claim counting. Cover every contextual family and every deterministic family in table-driven coverage checks. For permutations, permute records and reverse feature, claim, citation, warning, and reference arrays in cloned valid bundles, then compare both deep equality and `toCanonicalJson` bytes.

- [ ] **Step 2: Run the summary test file and observe the missing summary behavior**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.summary.test.ts`

  Expected: FAIL on conflict totals, mode/coverage, ordering, or decision-integrity assertions.

- [ ] **Step 3: Implement directional summaries and derived coverage**

  For contextual families in the fixed order `supportResistance`, `flows`, `derivatives`, `events`, `newsRegulatory`, sum selected score by all five direction buckets. Mark a family `CONFLICTED` iff both bullish and bearish are non-zero. For every family, derive `AVAILABLE`/`CONFLICTED` from selected items, `REJECTED` from candidates with none selected, and `MISSING` from no candidates. Derive deterministic family coverage separately and do not let it alter research mode.

- [ ] **Step 4: Derive mode and canonical warnings**

  Set `FULL` only when all contextual families are available, none is conflicted, and the brief is selected. Set `PARTIAL` when any contextual claim or brief is selected otherwise. Set `DEGRADED_NO_RESEARCH` when neither contextual claims nor brief survive. Produce stable missing/rejected/conflict/stale/no-research warnings from final state, deduplicate by code plus qualified subject, and sort with a constant family/code rank followed by explicit string keys.

- [ ] **Step 5: Canonically sort the complete result and assert integrity**

  Sort selected features/claims, bundles, decisions, conflicts, warnings, and references from copied arrays. Before returning, assert every candidate has one terminal decision, every selected qualified ID maps to exactly one `INCLUDED` decision, and every numeric score is a safe integer in range. Do not sort publisher-owned arrays inside the original item objects in place; clone and normalize them so inputs are never mutated.

- [ ] **Step 6: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.summary.test.ts`

  Expected: PASS with all ten summary/determinism invariants. The complete selector suite runs in the dedicated validation phase.

  Run: `pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.summary.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate must pass.

- [ ] **Step 7: Commit the deterministic summary behavior**

  ```bash
  git add src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.summary.test.ts
  git commit -m "m60: summarize selected evidence deterministically"
  ```

## Task 5: Add the repository-backed selection use case

**Files:**

- Create: `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts`
- Create: `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

**Exported API surface:** Add `SelectEvidenceForSynthesisUseCase`, `SelectEvidenceForSynthesisUseCaseDeps`, and `createSelectEvidenceForSynthesisUseCase`. The dependency type accepts the existing repository and clock plus an optional injected policy/selector for focused tests; production defaults are the shipped v1 policy and pure `selectEvidence` function. No method is added to `EvidenceBundleRepositoryPort`, so no adapter change is required.

**Behavioral invariants to write as tests first:**

- `captures the clock once and reads all current sources for the exact scope`: call `nowUnixMs()` once, then `getLatest` once with pair `SOL/USDC`, exact input scope, `source: null`, and that same instant.
- `passes the same records instant scope and configured policy to the selector`: no second clock read or observational source filter is introduced.
- `returns degraded success when the repository returns no records`: delegate empty arrays to the selector; do not convert absence to 404/error.
- `propagates EvidenceStoreUnavailableError unchanged without retry`: repository failure remains distinguishable from empty evidence and the selector is not called.
- `does not invoke history writes candles regime plan ledger or HTTP dependencies`: the dependency surface contains only repository, clock, selector, and policy.

- [ ] **Step 1: Write the failing application tests with focused fakes**

  Use a fake repository that implements the existing three port methods, records only `getLatest` calls, and can return records or throw a shared `EvidenceStoreUnavailableError` instance. Use a clock fake that increments a call counter and a selector spy that records its exact input. Assert object identity for propagated errors.

- [ ] **Step 2: Run the use-case test and observe the missing module failure**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Expected: FAIL because the use-case module does not exist.

- [ ] **Step 3: Implement the one-clock/one-read orchestration**

  Use this public shape and keep the returned value equal to the selector result:

  ```ts
  export type SelectEvidenceForSynthesisUseCase = (input: {
    readonly scope: Scope;
  }) => Promise<SelectedEvidenceSummary>;

  export const createSelectEvidenceForSynthesisUseCase =
    (deps: SelectEvidenceForSynthesisUseCaseDeps): SelectEvidenceForSynthesisUseCase =>
    async ({ scope }) => {
      const selectedAtUnixMs = deps.clock.nowUnixMs();
      const records = await deps.repository.getLatest({
        pair: "SOL/USDC",
        scope,
        source: null,
        nowUnixMs: selectedAtUnixMs
      });
      return (deps.selector ?? selectEvidence)({
        records,
        selectedAtUnixMs,
        scope,
        policy: deps.policy ?? EVIDENCE_SELECTION_POLICY_V1
      });
    };
  ```

  Do not catch repository errors, retry, call history, or reference deterministic market use cases.

- [ ] **Step 4: Run focused verification**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Expected: PASS with all five orchestration invariants.

  Run: `pnpm exec eslint src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate must pass.

- [ ] **Step 5: Commit the internal use case**

  ```bash
  git add src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts
  git commit -m "m60: expose evidence selection use case"
  ```

## Task 6: Wire nullable evidence selection without changing deterministic paths

**Files:**

- Modify: `src/composition/buildApplication.ts` (imports, `ApplicationDependencies` required member, construction, and returned object)
- Create: `src/composition/__tests__/evidenceSelectionWiring.test.ts`

**Exported API surface:** Add required member `selectEvidenceForSynthesis: SelectEvidenceForSynthesisUseCase | null` to `ApplicationDependencies` and return it from `buildApplication`. The interface change and all production construction/return updates are deliberately in this same task so the automatic workspace typecheck gate never sees an interface-only state.

**Behavioral invariants to write as tests first:**

- `exposes null selection when PostgreSQL evidence storage is not configured`: SQLite-only construction leaves deterministic use cases available and selection null.
- `exposes selection beside existing evidence use cases when PostgreSQL is configured`: one shared PostgreSQL evidence repository backs ingest/current/history/selection construction.
- `does not wire selection into regime or plan generation`: existing `getCurrentRegime` and `generatePlan` are constructed solely from their current candle/plan dependencies and remain callable when selection is null.
- `does not register a selection HTTP route`: composition exposes the internal use case only; route/OpenAPI files remain unchanged.

- [ ] **Step 1: Write the failing composition tests**

  Build a minimal `RuntimeStoreContext` with the existing in-memory ledger helper and `pg: null` for the first case. For the configured case, use a typed inert `Db` test double sufficient for construction (do not execute a query) and assert the four evidence use-case properties are non-null. Verify existing regime/plan property presence in the null case. For the internal-only invariant, start `buildApp()` with the SQLite-only context, inspect `/v1/openapi.json`, and assert no path contains `selection` or `synthesis`; this proves no route without modifying route/OpenAPI files.

- [ ] **Step 2: Run the wiring test and observe the missing property failure**

  Run: `pnpm exec vitest run src/composition/__tests__/evidenceSelectionWiring.test.ts`

  Expected: FAIL because `ApplicationDependencies` does not expose `selectEvidenceForSynthesis`.

- [ ] **Step 3: Update the interface and its production construction atomically**

  Import the type and factory, add the nullable required member next to the existing evidence use cases, construct it from the already-created `evidenceRepository` and shared `clock`, and include it in the returned object:

  ```ts
  const selectEvidenceForSynthesis = evidenceRepository
    ? createSelectEvidenceForSynthesisUseCase({ repository: evidenceRepository, clock })
    : null;
  ```

  Do not pass it into `createGetCurrentRegimeUseCase`, `createGeneratePlanUseCase`, `registerRoutes`, or any handler.

- [ ] **Step 4: Run focused verification**

  Run: `pnpm exec vitest run src/composition/__tests__/evidenceSelectionWiring.test.ts`

  Expected: PASS for configured/unconfigured wiring and deterministic-path isolation. The use-case contract runs again in the dedicated validation phase.

  Run: `pnpm exec eslint src/composition/buildApplication.ts src/composition/__tests__/evidenceSelectionWiring.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate proves every `ApplicationDependencies` producer/consumer was updated in the same task.

- [ ] **Step 5: Commit composition wiring**

  ```bash
  git add src/composition/buildApplication.ts src/composition/__tests__/evidenceSelectionWiring.test.ts
  git commit -m "m60: wire internal evidence selection"
  ```

**Tests to add or update**

- Add the four focused engine test files/builders listed above; keep scoring, lineage/state transitions, and summary/determinism in separate files so failures identify the policy stage.
- Add one application use-case test file for one-clock/one-read/error behavior.
- Add one composition test file for nullable wiring and deterministic-path isolation.
- Do not update existing raw evidence route/repository tests: their observational behavior is intentionally unchanged.
- Every behavioral invariant named in this plan and manifest is an exact `it(...)` test name and must be written before its implementation step.

**Dedicated validation phase (after all implementation tasks, not a standalone task)**

Run these exact repository commands after Task 6. They are the final cross-cutting gate; task-local acceptance commands above remain scoped to each task's changed paths.

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run boundaries
pnpm run build
pnpm run format
git diff --check
```

Expected: every command exits `0`; Vitest reports no failed tests, ESLint reports zero warnings, dependency-cruiser reports no engine/application boundary violations, build emits successfully, Prettier reports all files formatted, and `git diff --check` emits no output.

**Risk areas**

- Exact scoring can silently drift if multiplication/division is performed stepwise with `number`; require a single `bigint` numerator and test values that distinguish exact flooring from premature division.
- Candidate/reference IDs are only local to a bundle. Any raw-ID global map can cross-wire independent sources; all joins must include evidence hash/bundle identity.
- The family-cap → dependency fixed-point → brief sequence is stateful. Reordering stages, backfilling cap slots, or reviving an excluded decision changes safety semantics and canonical output.
- Lifecycle boundaries are easy to invert. Tests must pin equality at both bundle and item boundaries.
- Sorting with `localeCompare`, input mutation, or insertion-order iteration can make output environment/input-order dependent. Use explicit primitive comparators and cloned arrays.
- Static source/provenance weights are policy, not truth. Never read publisher `assessment.quality` or overall confidence as source quality; only brief scoring may use overall confidence as a ceiling.
- A configured PostgreSQL context switches candle adapters as well as evidence storage. The composition test should test construction only and avoid pretending an inert DB double can execute regime queries.
- The selector output is clock-dependent and ephemeral. Do not add persistence or a hash in this issue.
- Hard-guard precedence is completed by issue #61. This issue proves isolation structurally and must not add premature synthesis rules.

**Stop conditions**

- Stop and abort rather than continuing if `EvidenceBundleRepositoryPort.getLatest` no longer returns exact-scope latest-per-source records with caller-derived lifecycle; that invalidates the selector input contract and requires redesign.
- Stop if implementing the plan would require changing generated `src/contract/evidence/v1/types.generated.ts`, the evidence schema/migrations, HTTP/OpenAPI, or any deterministic regime/plan/hard-guard module. Those are explicit scope expansions.
- Stop if production asks for a non-empty reviewed `sourceQualityBps` override but cannot provide the exact publisher/source ID and policy-version approval; do not guess an identity.
- Stop if contract-valid lineage permits an identifier to resolve simultaneously to a feature and source reference within one bundle and existing semantic validation does not disambiguate it. Resolve that contract ambiguity before choosing precedence.
- Stop if exact score arithmetic can exceed the documented `0..10_000` result or a safe integer after validated factors; treat it as an invariant/configuration defect, not a clamped value.
- Stop if the interface change in Task 6 cannot be committed together with every `ApplicationDependencies` construction/consumer update; never leave a required-member surface change without its implementations under the automatic typecheck gate.

**Assumptions recorded for implementation**

- Issue #59 is merged and its `getLatest` behavior is the source of candidates; no history fallback is desired.
- Equality with `expiresAt` is usable and equality with `freshUntil` is fresh, matching current repository lifecycle derivation.
- Unknown exact source identities receive `5_000` bps; the initial reviewed override map is empty.
- Null-expiry contextual claims inherit the bundle lifecycle; stale deterministic features remain eligible at stale weight until bundle expiry.
- A brief requires every cited same-bundle item to survive final selection, and its cited average floors before the publisher-confidence ceiling is applied.
- Missing evidence is normal degraded success, while repository unavailability propagates as infrastructure failure.
- The first-line review marker is required because Tasks 2–4 implement explicit candidate decision transitions and a fixed-point dependency pass.
