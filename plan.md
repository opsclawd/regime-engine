<!-- plan-review-required -->

# Deterministic PolicyInsight Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synthesize, validate, deduplicate, persist, and serve one canonical advisory `PolicyInsight v1` from authoritative market/position state and the deterministic #60 evidence selection result.

**Architecture:** Add a pure, versioned policy reducer under `src/engine/policy`, then coordinate it from an application use case that captures time once, verifies all snapshot links, hashes canonical inputs, and persists through an append-only PostgreSQL port. Keep legacy external insight ingestion isolated for #62, while atomically cutting the canonical current/history reads over to the new store.

**Tech Stack:** TypeScript, Vitest, Zod contract validation supplied by #63, canonical JSON/SHA-256 utilities, Drizzle ORM, PostgreSQL, Fastify, ESLint, Prettier, dependency-cruiser.

---

### Dependency gate and assumptions

- #60 is present in this worktree through `SelectedEvidenceSummary` and `SelectEvidenceForSynthesisUseCase`.
- #63 is not present in this worktree. Do not start Task 1 until #63 is merged and `src/contract/v1/insights.ts` (or its #63 replacement) exports the canonical `PolicyInsightV1`, current/history response types, runtime parser, JSON/OpenAPI schema, identity rules, enum spellings, percentage units, and fixtures. This plan uses the semantic names `PolicyInsightV1`, `PolicyInsightCurrentResponse`, `PolicyInsightHistoryResponse`, and `parsePolicyInsightV1`; if #63 uses different names but identical semantics, update imports mechanically before implementation. Do not define aliases or a second contract to make the plan compile.
- The first ruleset supports only `SOL/USDC` and has the persisted identifier `sol-usdc-policy.v1`.
- Pair-scoped synthesis is valid without position context. Supplied position context is caller-owned truth and must include the exact authoritative `PlanResponse` generated for it.
- The existing `POST /v1/insights/sol-usdc` and `clmm_insights` table remain only for the #62 legacy-removal path. New synthesis never reads or writes them.
- No public synthesis endpoint or scheduler is added. Composition exposes the command to the established trusted internal caller.

### Goal

Produce exactly one strict, auditable `PolicyInsight v1` for a canonical synthesis input, with deterministic policy precedence, explicit degraded operation, race-safe idempotency, and canonical current/history reads.

### Non-goals

- Defining or changing the #63 wire contract.
- Changing evidence ingestion, scoring, selection, or scope-combination behavior.
- Reading raw sources, following URLs, parsing research prose for metrics, or using an LLM for policy decisions.
- Querying live wallet/position truth or implementing breach qualification, debounce, execution, retry, routing, slippage, approvals, signing, or transaction submission.
- Removing legacy external insight ingestion; #62 owns that cleanup.
- Adding multi-pair rules, an external synthesis route, scheduling, UI, backtesting, or automatic learning.

### Affected files

Create:

- `src/engine/policy/ruleset.ts`
- `src/engine/policy/reasoning.ts`
- `src/engine/policy/synthesizePolicyInsight.ts`
- `src/engine/policy/__tests__/policyFixtures.ts`
- `src/engine/policy/__tests__/ruleset.test.ts`
- `src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`
- `src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts`
- `src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`
- `src/application/errors/policyInsightErrors.ts`
- `src/application/ports/policyInsightRepositoryPort.ts`
- `src/application/use-cases/policyInsightFingerprints.ts`
- `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- `src/application/use-cases/getCurrentPolicyInsightUseCase.ts`
- `src/application/use-cases/getPolicyInsightHistoryUseCase.ts`
- `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- `src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts`
- `src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`
- `src/ledger/pg/schema/policyInsights.ts`
- `src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts`
- `src/ledger/pg/__tests__/policyInsightsMigration.test.ts`
- `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`
- `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts`
- `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts`
- `src/composition/__tests__/policyInsightWiring.test.ts`
- `src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`
- `src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`
- `drizzle/0006_create_policy_insights.sql`
- `drizzle/meta/0006_snapshot.json`

Modify:

- `src/application/use-cases/getCurrentRegimeUseCase.ts`
- `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts`
- `src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts`
- `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`
- `src/ledger/pg/schema/index.ts`
- `src/ledger/pg/db.ts`
- `src/composition/buildApplication.ts`
- `src/composition/buildApp.ts`
- `src/composition/__tests__/evidenceSelectionWiring.test.ts`
- `src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts`
- `src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts`
- `src/server.ts`
- `src/adapters/http/handlers/insightsCurrent.ts`
- `src/adapters/http/handlers/insightsHistory.ts`
- `src/adapters/http/routes.ts`
- `src/adapters/http/openapi.ts`
- drizzle/meta/\_journal.json
- `package.json`
- `documentation.md`

The #63 contract files are consumed but not modified by this issue.

### Behavioral invariants

The named tests below must be written before their implementations.

- `hard-stale market locks pause posture and blocks CLMM despite bullish evidence`: stage 1 wins over every lower stage.
- `qualified lower breach remains exit_range under bullish contextual evidence`: a lower breach cannot become hold/watch.
- `qualified upper breach remains exit_range under bearish contextual evidence`: an upper breach cannot become hold/watch.
- `active stand-down prevents lower-precedence deployment increases`: stage 3 locks action, posture, and CLMM permission through its supplied boundary.
- `cooldown never permits higher sensitivity or capital than the baseline`: cooldown establishes monotone caution bounds.
- `lower-precedence evidence can tighten but never relax locked policy fields`: risk can rise, confidence/capital can fall, and range can become more passive, never the reverse.
- `no evidence remains degraded rather than a successful zero signal`: #60 `DEGRADED_NO_RESEARCH` preserves empty lineage and emits explicit warnings.
- `expired and unknown evidence cannot affect policy`: excluded candidates and mismatched bindings remain audit-only.
- `one synthesis instant is shared by every time-sensitive collaborator`: the clock is read once and its value is passed to regime, position freshness, selection, generation, and persistence.
- `identical canonical inputs produce one stored insight`: retries and concurrent races return the same stored winner.
- `meaningful input or ruleset changes produce distinct history`: changes to scope, market, position/plan, selection, or ruleset change the synthesis input hash.
- `current and history never merge legacy externally authored rows`: canonical reads use only `policy_insights`.
- `repository unavailability never returns an unstored insight`: failures surface as service unavailable.
- `history pagination is stable across equal generation timestamps`: ordering and cursor comparison use `(generatedAtUnixMs DESC, id DESC)`.

## Task 1: Define and validate the versioned policy ruleset

**Files:**

- Create: `src/engine/policy/ruleset.ts`
- Create: `src/engine/policy/__tests__/ruleset.test.ts`

- [ ] **Step 1: Write failing ruleset tests first**

  Add named tests `accepts and freezes sol-usdc-policy.v1`, `rejects non-monotone thresholds`, `rejects duplicate reason ordering`, `rejects unsupported binding type or unit`, and `rejects an expiry configuration without a positive safety ttl`. Assert deep immutability and exact rejection messages.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/ruleset.test.ts`

  Expected: FAIL because `ruleset.ts` and its exports do not exist.

- [ ] **Step 3: Implement the immutable ruleset**

  Define the complete first-version policy surface in one file:

  ```ts
  export const POLICY_RULESET_VERSION = "sol-usdc-policy.v1" as const;

  export interface PolicyFeatureBinding {
    readonly bindingId: string;
    readonly family: string;
    readonly featureId: string;
    readonly calculatorName: string;
    readonly calculatorVersion: string;
    readonly kind: "number";
    readonly unit: string;
    readonly tighten: "risk" | "confidence" | "capital" | "range" | "support" | "resistance";
    readonly threshold: number;
  }

  export interface PolicyRuleset {
    readonly version: typeof POLICY_RULESET_VERSION;
    readonly maxInsightLifetimeMs: number;
    readonly positionMaxAgeMs: number;
    readonly degradedSafetyTtlMs: number;
    readonly confidenceOrder: readonly string[];
    readonly riskOrder: readonly string[];
    readonly postureOrder: readonly string[];
    readonly rangeBiasOrder: readonly string[];
    readonly reasonOrder: Readonly<Record<string, number>>;
    readonly featureBindings: readonly PolicyFeatureBinding[];
  }

  export declare const validatePolicyRuleset: (candidate: PolicyRuleset) => PolicyRuleset;
  export declare const SOL_USDC_POLICY_V1: PolicyRuleset;
  ```

  Use #63 enum values directly in the real implementation. Encode every precedence stage, monotone categorical order, freshness/expiry threshold, support/resistance limit, and deterministic feature binding in the ruleset; no reducer constant may silently alter output outside this version.

- [ ] **Step 4: Verify GREEN and local quality**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/ruleset.test.ts`

  Run: `pnpm exec eslint src/engine/policy/ruleset.ts src/engine/policy/__tests__/ruleset.test.ts`

  Expected: all focused tests pass and ESLint reports no warnings.

- [ ] **Step 5: Commit the task**

  Run: `git add src/engine/policy/ruleset.ts src/engine/policy/__tests__/ruleset.test.ts && git commit -m "m61: define policy synthesis ruleset"`

## Task 2: Implement hard-guard and market-regime precedence

**Files:**

- Create: `src/engine/policy/synthesizePolicyInsight.ts`
- Create: `src/engine/policy/__tests__/policyFixtures.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

**Invariants implemented first:**

- `hard-stale market locks pause posture and blocks CLMM despite bullish evidence`
- `qualified lower breach remains exit_range under bullish contextual evidence`
- `qualified upper breach remains exit_range under bearish contextual evidence`
- `active stand-down prevents lower-precedence deployment increases`
- `cooldown never permits higher sensitivity or capital than the baseline`

- [ ] **Step 1: Build canonical fixtures and write failing precedence tests**

  Create builders for fixed #63-valid pair scope, market snapshots, optional position/plan context, and empty/full #60 summaries. Table-drive stages 1-4: hard stale/insufficient safety data, lower and upper qualified breaches, blocked active position, stand-down, cooldown, `UP`, `DOWN`, and `CHOP`/`ALLOWED`. Assert exact advisory action, posture, risk floor, confidence ceiling, CLMM permission, reason order, and expiry.

- [ ] **Step 2: Run the focused precedence suite and confirm RED**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

  Expected: FAIL because the reducer is not implemented.

- [ ] **Step 3: Implement the pure ordered reducer**

  Export a reducer with an immutable envelope and explicit lock state:

  ```ts
  export interface PolicySynthesisEnvelope {
    readonly synthesisAtUnixMs: number;
    readonly pair: "SOL/USDC";
    readonly scope: Scope;
    readonly market: RegimeCurrentResponse;
    readonly positionPlan: {
      readonly position: PlanRequestPosition;
      readonly plan: PlanResponse;
    } | null;
    readonly evidence: SelectedEvidenceSummary;
    readonly hashes: PolicySynthesisHashes;
  }

  export function synthesizePolicyInsight(
    envelope: PolicySynthesisEnvelope,
    ruleset: PolicyRuleset
  ): PolicyInsightV1;
  ```

  Apply stages in fixed order. Represent locks explicitly (`action`, `posture`, `riskFloor`, `confidenceCeiling`, `allowClmm`, capital/sensitivity bounds) and expose no generic score that can cancel a guard. Map authoritative plan actions (`REQUEST_EXIT_CLMM`, `STAND_DOWN`, `HOLD`) without re-running breach or churn qualification. Compute expiry as the earliest ruleset, market, position, and selected-evidence boundary.

- [ ] **Step 4: Verify precedence and boundary isolation**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

  Run: `pnpm exec eslint src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

  Run: `pnpm exec depcruise --config .dependency-cruiser.cjs --output-type err "src/engine/policy/**/*.ts"`

  Expected: all scenarios pass; the policy engine imports only engine/contract modules and runtime-free types.

- [ ] **Step 5: Commit the task**

  Run: `git add src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts && git commit -m "m61: enforce policy precedence guards"`

## Task 3: Add monotone evidence refinement and deterministic reasoning

**Files:**

- Create: `src/engine/policy/reasoning.ts`
- Modify: `src/engine/policy/synthesizePolicyInsight.ts`
- Modify: `src/engine/policy/__tests__/policyFixtures.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

**Invariants implemented first:**

- `lower-precedence evidence can tighten but never relax locked policy fields`
- `no evidence remains degraded rather than a successful zero signal`
- `expired and unknown evidence cannot affect policy`
- `contextual prose and research briefs never create actions or numerical levels`
- `fixed input produces byte-identical canonical insight output`

- [ ] **Step 1: Write failing evidence and determinism tests**

  Cover FULL/PARTIAL/DEGRADED selection, stale selected evidence, expired exclusions, missing families, conflicts, missing/rejected brief, allowlisted deterministic features, mismatched calculator/type/unit, support/resistance sorting/deduplication/bounds, and no structured levels. Add calm CHOP, upward, downward, stressed/high-volatility, sparse-evidence, and poor-price-quality fixtures. Snapshot canonical JSON twice for the same fixed envelope.

- [ ] **Step 2: Confirm RED**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

  Expected: FAIL because evidence stages 5-7 and reasoning templates are absent.

- [ ] **Step 3: Implement bounded evidence interpretation**

  Match deterministic features on the full binding tuple and allow only configured tightening. Aggregate selected contextual directions and #60 conflict totals; conflict can increase risk or reduce confidence but cannot produce a directional upgrade. Treat the selected research brief as lineage/explanation only. Extract prices only from allowlisted numeric support/resistance features with the exact unit; never parse claim or brief text.

- [ ] **Step 4: Implement fixed reasoning and warning templates**

  Export deterministic rendering functions:

  ```ts
  export function renderPolicyReasoning(input: {
    readonly orderedReasonCodes: readonly string[];
    readonly boundedIdentifiers: readonly string[];
  }): readonly string[];

  export function renderPolicyWarnings(input: {
    readonly selection: SelectedEvidenceSummary;
    readonly derivedWarnings: readonly string[];
  }): readonly string[];
  ```

  Sort reason codes by precedence then lexicographically, map #60 warnings without losing original lineage, cap all strings/arrays to #63 limits, and include `ADVISORY_ONLY`/no-execution authority. Do not copy arbitrary prose into machine codes or numeric fields.

- [ ] **Step 5: Verify evidence behavior and determinism**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

  Run: `pnpm exec eslint src/engine/policy/reasoning.ts src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

  Expected: every degraded case remains explicit, every monotone assertion passes, and repeated canonical output is byte-identical.

- [ ] **Step 6: Commit the task**

  Run: `git add src/engine/policy/reasoning.ts src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts && git commit -m "m61: refine policy with selected evidence"`

## Task 4: Create the append-only policy insight schema and migration

**Files:**

- Create: `src/ledger/pg/schema/policyInsights.ts`
- Modify: `src/ledger/pg/schema/index.ts`
- Create: `src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts`
- Create: `src/ledger/pg/__tests__/policyInsightsMigration.test.ts`
- Create: `drizzle/0006_create_policy_insights.sql`
- Create: `drizzle/meta/0006_snapshot.json`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write failing schema-shape and migration tests**

  Add named tests `rejects duplicate canonical synthesis input` and `enforces policy insight audit checks without legacy foreign keys`. Assert all audit columns, JSONB payloads, lowercase 64-character hash checks, timestamp ordering, unique `(schema_version, ruleset_version, synthesis_input_hash)`, unique canonical insight ID, and current/history indexes. The migration test must migrate an empty database, insert one valid row, reject invalid hashes/timestamps/duplicate inputs, and prove no foreign key to legacy `clmm_insights` exists.

- [ ] **Step 2: Confirm RED**

  Run: `pnpm exec vitest run src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts`

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsMigration.test.ts`

  Expected: FAIL because the schema/table/migration do not exist.

- [ ] **Step 3: Add the Drizzle schema and generated migration artifacts**

  Define `regime_engine.policy_insights` with surrogate `id`, canonical `insight_id`, schema/ruleset versions, pair/scope/optional position ID, generated/as-of/expiry/persisted times, market/position/selection/input hashes, selection-policy version, canonical input JSON, canonical output JSON, output canonical text/hash, and selected/excluded lineage JSON. Add only INSERT-oriented indexes; no update timestamp or mutable status column.

- [ ] **Step 4: Verify schema and migration behavior**

  Run: `pnpm exec vitest run src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts`

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsMigration.test.ts`

  Run: `pnpm exec eslint src/ledger/pg/schema/policyInsights.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts src/ledger/pg/__tests__/policyInsightsMigration.test.ts`

  Expected: schema and migration tests pass against a migrated PostgreSQL database.

- [ ] **Step 5: Commit the task**

  Run: `git add src/ledger/pg/schema/policyInsights.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/policyInsights.shape.test.ts src/ledger/pg/__tests__/policyInsightsMigration.test.ts drizzle/0006_create_policy_insights.sql drizzle/meta/0006_snapshot.json drizzle/meta/_journal.json && git commit -m "m61: add append-only policy insight storage"`

## Task 5: Add race-safe command persistence through the port and PostgreSQL adapter

**Files:**

- Create: `src/application/errors/policyInsightErrors.ts`
- Create: `src/application/ports/policyInsightRepositoryPort.ts`
- Create: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

**Port/interface rule:** This task introduces command methods and their only adapter together. Do not commit the port without the PostgreSQL implementation.

**Invariants implemented first:**

- `identical canonical inputs produce one stored insight`
- `concurrent identical inserts return the persisted winner`
- `repository unavailability never returns an unstored insight`

- [ ] **Step 1: Write failing PostgreSQL command tests**

  Test `findBySynthesisInputHash` miss/hit, first insert, exact replay, concurrent same-input insertion, changed-input insertion, canonical JSON round-trip, append-only behavior, and transient connection errors mapped to `PolicyInsightStoreUnavailableError`.

- [ ] **Step 2: Confirm RED**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

  Expected: FAIL because the port and adapter do not exist.

- [ ] **Step 3: Define the command port and audit record**

  ```ts
  export interface PolicyInsightRepositoryPort {
    findBySynthesisInputHash(input: {
      readonly schemaVersion: string;
      readonly rulesetVersion: string;
      readonly synthesisInputHash: string;
    }): Promise<StoredPolicyInsight | null>;

    insertOrGet(input: NewPolicyInsightRecord): Promise<{
      readonly status: "created" | "already_exists";
      readonly record: StoredPolicyInsight;
    }>;
  }
  ```

  `NewPolicyInsightRecord` must require every typed/indexed field, complete canonical input envelope, selection decisions/lineage, validated canonical output, output canonical string, and payload hash. `StoredPolicyInsight` must return the stored canonical #63 payload without reconstructing it from columns.

- [ ] **Step 4: Implement atomic insert-or-return-existing**

  Use one transaction and `ON CONFLICT DO NOTHING` on the unique input tuple. If insertion loses, select the winner by the same tuple and return it. If the conflict fires but no winner can be read, throw an append-only invariant error. Never update/delete a row and never fall back to memory.

- [ ] **Step 5: Verify the port and adapter together**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

  Run: `pnpm exec eslint src/application/errors/policyInsightErrors.ts src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`

  Expected: race tests return one row/insight ID and failure tests return no fabricated record.

- [ ] **Step 6: Commit the task**

  Run: `git add src/application/errors/policyInsightErrors.ts src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts && git commit -m "m61: persist synthesized insights idempotently"`

## Task 6: Orchestrate synthesis with one clock instant and canonical fingerprints

**Files:**

- Create: `src/application/use-cases/policyInsightFingerprints.ts`
- Create: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Create: `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- Modify: `src/application/use-cases/getCurrentRegimeUseCase.ts`
- Modify: `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts`
- Modify: `src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

**Invariants implemented first:**

- `one synthesis instant is shared by every time-sensitive collaborator`
- `pair scope selection time and position plan hash mismatches persist nothing`
- `exact replay returns the stored canonical winner without reducing again`
- `meaningful input or ruleset changes produce distinct history`
- `runtime contract rejection persists nothing`

- [ ] **Step 1: Write failing orchestration tests**

  Use fakes/spies to prove the clock is called once; the same instant reaches the regime read, selector, position freshness check, output generation, and persisted metadata. Reject pair/scope mismatch, selection-time mismatch, stale supplied position, unverified plan hash, plan/position identity mismatch, and #63 parser failure before insert. Prove replay short-circuits and changed market/position/selection/scope/ruleset changes the input hash.

- [ ] **Step 2: Confirm RED**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Expected: FAIL because explicit shared instants, fingerprints, and synthesis orchestration are absent.

- [ ] **Step 3: Make existing reads accept an explicit captured instant**

  Change the exported call surfaces without adding a second clock:

  ```ts
  export type GetCurrentRegimeUseCase = (
    query: RegimeCurrentQuery,
    observedAtUnixMs?: number
  ) => Promise<RegimeCurrentResponse>;

  export type SelectEvidenceForSynthesisUseCase = (input: {
    readonly scope: Scope;
    readonly selectedAtUnixMs?: number;
  }) => Promise<SelectedEvidenceSummary>;
  ```

  HTTP callers may omit the value and preserve existing behavior; synthesis supplies it. Validate supplied instants as non-negative finite integers. Do not call the dependency clock when an explicit instant is present.

- [ ] **Step 4: Implement canonical fingerprints and orchestration**

  Export `createSynthesizePolicyInsightUseCase(deps)` and `SynthesizePolicyInsightUseCase`. Capture `synthesisAtUnixMs` once; load/verify the canonical market snapshot, exact evidence scope, and optional position/plan; canonicalize and SHA-256 the market projection, position/plan or `NONE`, and full selection; then hash ruleset+pair+scope+component hashes. Exclude only documented presentation ages, never identities, decisions, freshness class/boundaries, policy versions, or lineage.

  On repository hit, return the stored canonical output. On miss, reduce, validate with #63, canonicalize/hash the output, and call `insertOrGet`. Derive `insightId` using #63's identity format from `synthesisInputHash`. Map transient evidence/insight persistence failures explicitly and never return an unpersisted output.

- [ ] **Step 5: Verify orchestration and changed signatures**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Run: `pnpm exec eslint src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/getCurrentRegimeUseCase.ts src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Expected: all mismatch paths persist zero rows, exact replay returns one ID, and all time assertions use one captured value.

- [ ] **Step 6: Commit the task**

  Run: `git add src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/getCurrentRegimeUseCase.ts src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts && git commit -m "m61: orchestrate canonical policy synthesis"`

## Task 7: Add canonical current reads through the port and adapter

**Files:**

- Modify: `src/application/ports/policyInsightRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts`
- Create: `src/application/use-cases/getCurrentPolicyInsightUseCase.ts`
- Create: `src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts`

**Port/interface rule:** Add `getCurrent` and its PostgreSQL implementation in this same task.

**Invariants implemented first:**

- `current returns newest canonical row by generated time then row id`
- `current never reads legacy clmm_insights`
- `current read is side-effect free`

- [ ] **Step 1: Write failing repository/use-case tests**

  Insert pair- and position-scoped rows, including equal generation timestamps. Assert exact scope filtering, `(generatedAtUnixMs DESC, id DESC)` selection, null on no row, persisted payload round-trip, no legacy rows, and no INSERT/UPDATE during current reads.

- [ ] **Step 2: Confirm RED**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts`

  Expected: FAIL because `getCurrent` and its use case do not exist.

- [ ] **Step 3: Add the port method, adapter query, and thin use case together**

  ```ts
  getCurrent(input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
  }): Promise<StoredPolicyInsight | null>;
  ```

  The use case captures query time only for #63 freshness wrapping, returns the stored canonical payload unchanged, and throws `PolicyInsightNotFoundError` for no row. It never synthesizes on GET.

- [ ] **Step 4: Verify current behavior**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts`

  Run: `pnpm exec eslint src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts src/application/use-cases/getCurrentPolicyInsightUseCase.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts`

- [ ] **Step 5: Commit the task**

  Run: `git add src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts src/application/use-cases/getCurrentPolicyInsightUseCase.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts && git commit -m "m61: read current canonical policy insight"`

## Task 8: Add stable cursor history through the port and adapter

**Files:**

- Modify: `src/application/ports/policyInsightRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts`
- Create: `src/application/use-cases/getPolicyInsightHistoryUseCase.ts`
- Create: `src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

**Port/interface rule:** Add `getHistory` and its PostgreSQL implementation in this same task.

**Invariants implemented first:**

- `history pagination is stable across equal generation timestamps`
- `history returns changed canonical inputs as distinct rows`
- `history never returns legacy externally authored rows`

- [ ] **Step 1: Write failing history tests**

  Cover empty history, default/max limit, invalid limits, exact scope filtering, equal-timestamp tie-breaking, cursor encode/decode round-trip, no duplicates or gaps across pages, and canonical JSON round-trip.

- [ ] **Step 2: Confirm RED**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

  Expected: FAIL because history support does not exist.

- [ ] **Step 3: Add the port method, adapter query, and use case together**

  ```ts
  export interface PolicyInsightHistoryCursor {
    readonly generatedAtUnixMs: number;
    readonly id: number;
  }

  getHistory(input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly limit: number;
    readonly cursor: PolicyInsightHistoryCursor | null;
  }): Promise<{
    readonly records: readonly StoredPolicyInsight[];
    readonly nextCursor: PolicyInsightHistoryCursor | null;
  }>;
  ```

  Query with the strict tuple predicate `(generated_at_unix_ms, id) < (cursor.generatedAtUnixMs, cursor.id)`, request `limit + 1`, and derive the next cursor from the last returned item. Map results into #63's history envelope in the use case, not the repository.

- [ ] **Step 4: Verify pagination**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

  Run: `pnpm exec eslint src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/getPolicyInsightHistoryUseCase.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`

- [ ] **Step 5: Commit the task**

  Run: `git add src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres/postgresPolicyInsightRepository.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/application/use-cases/getPolicyInsightHistoryUseCase.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts && git commit -m "m61: paginate canonical policy insight history"`

## Task 9: Wire synthesis and canonical reads into composition and startup checks

**Files:**

- Modify: `src/composition/buildApplication.ts`
- Create: `src/composition/__tests__/policyInsightWiring.test.ts`
- Modify: `src/ledger/pg/db.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write failing composition/startup tests**

  Add named tests `wires policy insight capabilities only when postgres is configured` and `fails startup verification when policy_insights is missing`. Assert that PostgreSQL composition creates one repository shared by synthesis/current/history, exposes `synthesizePolicyInsight`, `getCurrentPolicyInsight`, and `getPolicyInsightHistory`, and returns all three as `null` without PostgreSQL. Assert startup fails with the existing migration guidance when `policy_insights` is absent.

- [ ] **Step 2: Confirm RED**

  Run: `pnpm exec vitest run src/composition/__tests__/policyInsightWiring.test.ts src/ledger/pg/__tests__/db.test.ts`

  Expected: FAIL because composition and table verification are missing.

- [ ] **Step 3: Wire the complete capability**

  Extend `ApplicationDependencies` with nullable command/current/history use cases. When `ctx.pg` and #60 selection are available, build `createPostgresPolicyInsightRepository`, then create all three use cases with the shared clock and ruleset. Without PostgreSQL, expose `null`; do not create an in-memory fallback. Add `verifyPolicyInsightsTable` to startup verification after migrations.

- [ ] **Step 4: Verify composition and startup scope**

  Run: `pnpm exec vitest run src/composition/__tests__/policyInsightWiring.test.ts src/ledger/pg/__tests__/db.test.ts`

  Run: `pnpm exec eslint src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts src/ledger/pg/db.ts src/server.ts`

  Expected: wiring tests pass in both PostgreSQL and no-PostgreSQL modes; missing table fails fast.

- [ ] **Step 5: Commit the task**

  Run: `git add src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts src/ledger/pg/db.ts src/server.ts && git commit -m "m61: compose policy insight synthesis"`

## Task 10: Cut the current insight resource over to canonical policy storage

**Files:**

- Modify: `src/adapters/http/handlers/insightsCurrent.ts`
- Modify: `src/adapters/http/routes.ts`
- Modify: `src/adapters/http/openapi.ts`
- Modify: `src/composition/buildApplication.ts`
- Modify: `src/composition/buildApp.ts`
- Modify: `src/composition/__tests__/evidenceSelectionWiring.test.ts`
- Modify: `src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts`
- Modify: `src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts`
- Modify: `src/server.ts`
- Create: `src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`

**Invariants implemented first:**

- `current endpoint returns only the newest canonical policy insight`
- `current endpoint never synthesizes or returns legacy rows`
- `current endpoint distinguishes not found store unavailable validation and internal errors`

- [ ] **Step 1: Write the new focused current endpoint tests**

  Do not enlarge `insights.e2e.pg.test.ts` (it already has 15 test cases). In the new file, cover #63-valid success/freshness response, pair/position scope query, 400 invalid query, 404 no canonical row, 503 unavailable repository, stable same-timestamp winner, and proof that an existing legacy row is ignored.

- [ ] **Step 2: Confirm RED**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`

  Expected: FAIL because the current route still uses `InsightsStore` and the legacy DTO.

- [ ] **Step 3: Replace only the current read dependency**

  Route `GET /v1/insights/sol-usdc/current` to `GetCurrentPolicyInsightUseCase | null`; keep POST wired to `InsightsStore` for #62. Parse #63's approved scope selector, return its exact current response shape, and map not-found/unavailable/validation/internal errors through the canonical taxonomy. The handler performs no writes and no synthesis. Update the composition root in `src/composition/buildApplication.ts` and `src/server.ts` to provide `getCurrentPolicyInsight` to `HttpRouteDependencies` so that the dependencies align, avoiding any breaking type errors.

- [ ] **Step 4: Update only the current OpenAPI operation**

  Replace the current operation's success/query/error schemas with #63's canonical definitions. Do not change the POST or history operation in this task.

- [ ] **Step 5: Verify current cutover**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`

  Run: `pnpm exec eslint src/adapters/http/handlers/insightsCurrent.ts src/adapters/http/routes.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`

  Expected: canonical current tests pass and the legacy-only row remains invisible.

- [ ] **Step 6: Commit the task**

  Run: `git add src/adapters/http/handlers/insightsCurrent.ts src/adapters/http/routes.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts src/composition/buildApplication.ts src/server.ts && git commit -m "m61: serve current canonical policy insight"`

## Task 11: Cut history over and document the trusted synthesis boundary

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
