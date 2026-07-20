<!-- plan-review-required -->

# Canonical PolicyInsight v1 Wire Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and serve one strict, schema-first `policy-insight.v1` contract for current and history reads, with deterministic canonical content, read-time freshness, and fail-closed persistence that never converts legacy rows.

**Architecture:** A draft-2020-12 JSON Schema under `contracts/policy-insight/v1/` is the source of truth. Generated TypeScript and an AJV-plus-semantic validator protect synthesis, persistence, and read projection; PostgreSQL marks canonical rows with the exact schema digest, while current/history use cases add freshness from one injected-clock instant and HTTP sends the validated result unchanged.

**Tech stack:** TypeScript, Node.js 22, JSON Schema draft 2020-12, AJV, `json-schema-to-typescript`, Fastify/OpenAPI, Drizzle/PostgreSQL, Vitest, pnpm.

---

**Goal details**

- Give `clmm-v2` exact source and built artifacts to pin by repository commit, schema version, schema path, and SHA-256.
- Replace ambiguous percent fields, numeric/singular levels, categorical confidence, and legacy advisory values with explicit basis points, canonical decimal strings, and closed enums.
- Make the immutable content hash independent of dynamic freshness and make both read endpoints return the same `PolicyInsightRead` item shape.
- Keep existing database rows append-only and invisible to canonical reads unless they carry the supported schema digest.

**Non-goals**

- Do not implement evidence ingestion or selection changes from issues #59/#60.
- Do not add new policy/research interpretation beyond the explicit v1 mappings required by the design; issue #61 owns new synthesis policy.
- Do not modify `clmm-v2`, remove the legacy final-policy POST/table owned by #62, add multi-pair support, or add content negotiation.
- Do not backfill, coerce, rewrite, or expose legacy `policy_insights` rows as canonical v1.
- Do not add execution, signing, transaction, route, slippage, or wallet-approval fields; this contract remains advisory.

**Affected-file map**

- `contracts/policy-insight/v1/` owns the authoritative schema, digest, and consumer fixtures.
- `scripts/generatePolicyInsightContract.ts` and `src/contract/policyInsight/v1/types.generated.ts` own reproducible type/digest generation.
- `src/contract/policyInsight/v1/{canonical,validate,project}.ts` own canonical hashing, structural/semantic validation, and dynamic freshness projection.
- `src/engine/policy/` owns advisory action precedence, basis-point mappings, evidence/level projection, reasons, warnings, and deterministic prose.
- `src/application/ports/policyInsightRepositoryPort.ts`, `src/adapters/postgres/postgresPolicyInsightRepository.ts`, `src/ledger/pg/schema/policyInsights.ts`, and `drizzle/0007_mark_policy_insight_wire_contract.sql` form one persistence boundary and therefore change together.
- `src/application/use-cases/{synthesizePolicyInsightUseCase,getCurrentPolicyInsightUseCase,getPolicyInsightHistoryUseCase}.ts` own final immutable-content assembly and shared-clock read projection.
- `src/adapters/http/handlers/{insightsCurrent,insightsHistory}.ts` become parsing/error adapters only; `src/adapters/http/openapi.ts` references the published schema and fixtures.
- `docs/contracts/policy-insight.v1.md` and `scripts/copyBuildAssets.mjs` document and ship the downstream handoff.

**Implementation assumptions**

- `insightId` remains the existing lowercase SHA-256 synthesis identity; the application adds it to the reducer draft before final content validation and hashing.
- `payloadCanonical` and `payloadHash` describe immutable `PolicyInsightContent`, never a `PolicyInsightRead` containing freshness.
- Lower-bound qualified exits target USDC; upper-bound qualified exits target SOL.
- Existing confidence categories map temporarily to 2,500/5,000/7,500 bps and existing integer deployment percentages map by exact multiplication by 100. Invalid transitional values throw instead of rounding.
- Only selected, non-audit, structured `price_usdc_per_sol` evidence may produce levels. Position bounds and prose are not level evidence.
- A deployment with only unmarked legacy rows may return `404` until a canonical synthesis is written; rollout documentation must call this out.

## Task 1: Publish the schema, generated types, digest, and fixture corpus

**Files:**

- Create: `contracts/policy-insight/v1/policy-insight.schema.json`
- Create: `contracts/policy-insight/v1/schema.sha256`
- Create: `contracts/policy-insight/v1/fixtures/valid/current-pair.json`
- Create: `contracts/policy-insight/v1/fixtures/valid/current-position.json`
- Create: `contracts/policy-insight/v1/fixtures/valid/history.json`
- Create: `contracts/policy-insight/v1/fixtures/invalid/fields-and-enums.json`
- Create: `contracts/policy-insight/v1/fixtures/invalid/numbers-and-levels.json`
- Create: `contracts/policy-insight/v1/fixtures/invalid/timestamps-and-freshness.json`
- Create: `contracts/policy-insight/v1/fixtures/invalid/ordering-and-duplicates.json`
- Create: `contracts/policy-insight/v1/fixtures/invalid/action-position-and-version.json`
- Create: `scripts/generatePolicyInsightContract.ts`
- Create: `src/contract/policyInsight/v1/types.generated.ts`
- Create: `src/contract/policyInsight/v1/__tests__/generation.test.ts`
- Modify: `package.json`

**Exported API changes:** Add generated `PolicyInsightContent`, `PolicyInsightFreshness`, `PolicyInsightRead`, and `PolicyInsightHistoryResponse` interfaces in `src/contract/policyInsight/v1/types.generated.ts`.

**Behavioral invariants (write these named tests first):**

- `keeps generated PolicyInsight v1 artifacts reproducible`: `--check` performs no writes, succeeds only when generated bytes match, and fails with the drifted path otherwise.
- `publishes the exact schema path version and sha256`: the digest is computed over the exact authoritative schema bytes and identifies the documented repository-relative path/version.
- `provides pair position and history valid fixtures`: all three public success variants are represented with fixed canonical values.
- `provides named invalid cases for every documented drift class`: every required negative category is present with one intended error path/code.

- [ ] **Step 1: Write the failing generation and fixture-shape tests.**

  In `generation.test.ts`, invoke the generator with `--check`, recompute SHA-256 from the exact schema bytes, load every named fixture suite, and assert that each invalid entry contains `{ name, payload, expectedPath, expectedCode }`. Test names:

  ```ts
  it("keeps generated PolicyInsight v1 artifacts reproducible", async () => {});
  it("publishes the exact schema path version and sha256", () => {});
  it("provides pair position and history valid fixtures", () => {});
  it("provides named invalid cases for every documented drift class", () => {});
  ```

- [ ] **Step 2: Run the focused test and confirm it fails because the artifacts and command do not exist.**

  Run: `pnpm exec vitest run src/contract/policyInsight/v1/__tests__/generation.test.ts`

  Expected: FAIL resolving the new generator/schema files or the `contract:policy-insight:check` script.

- [ ] **Step 3: Author the closed JSON Schema.**

  Use `$schema: "https://json-schema.org/draft/2020-12/schema"`, the exact `$id` from `design.md`, root `$ref: "#/$defs/PolicyInsightRead"`, and `$defs` for `PolicyInsightContent`, `PolicyInsightFreshness`, `PolicyInsightRead`, and `PolicyInsightHistoryResponse`. Set `additionalProperties: false` on every object, require every field, allow `null` only for `position` and `nextCursor`, and encode these public shapes exactly:

  ```ts
  type PolicyInsightRead = PolicyInsightContent & {
    freshness: {
      status: "FRESH" | "STALE";
      evaluatedAt: string;
      ageSeconds: number;
    };
  };

  type PolicyInsightHistoryResponse = {
    schemaVersion: "policy-insight.v1";
    pair: "SOL/USDC";
    queriedAt: string;
    limit: number;
    items: PolicyInsightRead[];
    nextCursor: string | null;
  };
  ```

  Encode the six advisory actions, every enum/reason/warning value in `design.md`, integer `0..10000` bps bounds, identifier/string/array bounds, exact millisecond-UTC timestamp regex, canonical positive-decimal regex, and explicit supports/resistances unit names. Schema descriptions must state semantic rules that JSON Schema cannot express.

- [ ] **Step 4: Create the consumer fixtures.**

  Valid fixtures must cover pair scope with empty levels, position scope with selected bundle/source lineage, and a two-item history response. Invalid suite entries must independently cover old names, numeric levels, malformed decimals, all enum classes, unknown fields at each nesting depth, bps type/range/integer failures, noncanonical timestamps, impossible timestamp/freshness relationships, action/position incompatibility, duplicates/order errors, and unsupported schema version. Use fixed timestamps and 64-character lowercase hex identities so only the intended invariant fails.

- [ ] **Step 5: Implement deterministic generation.**

  Mirror `scripts/generateEvidenceContract.ts`: resolve paths from the repository root, compile TypeScript from the schema, format with Prettier, compute SHA-256 over exact schema bytes, and support only `--write` and `--check`. `--check` must print a path-specific drift error and exit nonzero without writing; `--write` updates generated types, `schema.sha256`, and canonical formatting for all fixture suite files. Add:

  ```json
  {
    "contract:policy-insight:generate": "tsx scripts/generatePolicyInsightContract.ts --write",
    "contract:policy-insight:check": "tsx scripts/generatePolicyInsightContract.ts --check"
  }
  ```

  Make `pnpm run test` run the policy-insight check before `vitest run`, so the normal quality gate detects drift.

- [ ] **Step 6: Generate artifacts and rerun focused verification.**

  Run: `pnpm run contract:policy-insight:generate`

  Expected: generated types and `schema.sha256` are written deterministically.

  Run: `pnpm run contract:policy-insight:check && pnpm exec vitest run src/contract/policyInsight/v1/__tests__/generation.test.ts`

  Expected: PASS, and a second `--check` reports no drift.

- [ ] **Step 7: Commit the contract source of truth.**

  ```bash
  git add contracts/policy-insight/v1 scripts/generatePolicyInsightContract.ts src/contract/policyInsight/v1/types.generated.ts src/contract/policyInsight/v1/__tests__/generation.test.ts package.json
  git commit -m "m63: publish policy insight v1 schema"
  ```

## Task 2: Enforce semantic validation, immutable hashing, and freshness projection

**Files:**

- Create: `src/contract/policyInsight/v1/canonical.ts`
- Create: `src/contract/policyInsight/v1/validate.ts`
- Create: `src/contract/policyInsight/v1/project.ts`
- Create: `src/contract/policyInsight/v1/__tests__/validation.test.ts`
- Create: `src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts`
- Create: `src/contract/policyInsight/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap`
- Create: `src/contract/policyInsight/v1/__tests__/project.test.ts`

**Exported API changes:** Add `PolicyInsightValidationIssue`, `PolicyInsightValidationError`, `parsePolicyInsightContent`, `parsePolicyInsightRead`, `parsePolicyInsightHistoryResponse`, `computePolicyInsightContentCanonicalAndHash`, `projectPolicyInsightRead`, and `projectPolicyInsightHistoryResponse`.

**Behavioral invariants (write these named tests first):**

- `accepts canonical content and rejects every named invalid fixture at its expected path`: structure and semantic validation agree with the fixture matrix.
- `requires asOf <= generatedAt < expiresAt`: any reversed or equal generated/expiry relationship fails semantically.
- `sorts no input and rejects noncanonical level reference reason and warning order`: validation never silently repairs persisted/public data.
- `compares decimal level strings without binary floating point`: supports are strictly descending, resistances strictly ascending, and numeric equality such as `"1"` versus `"1.0"` cannot enter canonical content.
- `requires actions with position semantics to include position identity`: monitor and exit actions fail when `position` is null; pair-scoped `HOLD` and `STAND_DOWN` remain valid.
- `marks freshness fresh immediately before expiry`: `evaluatedAt < expiresAt` yields `FRESH`.
- `marks freshness stale at exact expiry`: equality yields `STALE`.
- `marks freshness stale after expiry`: later evaluation yields `STALE`.
- `computes nonnegative floored age seconds from asOf`: negative age is rejected and fractional seconds floor deterministically.
- `uses one evaluatedAt for every projected history item`: one supplied query instant is projected into the envelope and every item.
- `hashes immutable content without freshness`: changing the read instant never changes content canonical JSON/hash; object-key order does not matter and array order does.

- [ ] **Step 1: Add the failing fixture, semantic, projection, and snapshot tests named above.** Use the published valid fixtures as bases and deep-clone/mutate one condition per case so error paths remain attributable.

- [ ] **Step 2: Run the contract-only tests and observe failures for missing exports.**

  Run: `pnpm exec vitest run src/contract/policyInsight/v1/__tests__/validation.test.ts src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts src/contract/policyInsight/v1/__tests__/project.test.ts`

  Expected: FAIL resolving `canonical.ts`, `validate.ts`, and `project.ts`.

- [ ] **Step 3: Implement canonical hashing.** Reuse the repository's sorted-key canonical JSON and SHA-256 behavior, but expose a content-specific function so freshness cannot be passed accidentally:

  ```ts
  export function computePolicyInsightContentCanonicalAndHash(content: PolicyInsightContent) {
    const canonical = toCanonicalJson(content);
    return { canonical, hash: sha256Hex(canonical) };
  }
  ```

- [ ] **Step 4: Implement AJV structural and explicit semantic validation.** Compile the published schema once with AJV 2020 and validators for the content, read, and history `$defs`. Return typed values only after checking canonical timestamps, timestamp ordering, freshness status/math, arbitrary-precision decimal ordering/uniqueness, action/position compatibility, selected-reference tuple ordering/uniqueness, precedence-then-lexicographic reason order, and code/message warning order. Never coerce, sort, round, or insert defaults.

- [ ] **Step 5: Implement the pure read projectors.** `projectPolicyInsightRead(content, evaluatedAtUnixMs)` must validate a nonnegative integer instant, format it once, compute exclusive-boundary status and floored age, then parse the complete read. `projectPolicyInsightHistoryResponse` must accept already ordered contents plus `limit`, cursor string/null, and one query instant; reuse `projectPolicyInsightRead` for every item and validate the final envelope.

- [ ] **Step 6: Run focused verification and accept snapshots.**

  Run: `pnpm exec vitest run src/contract/policyInsight/v1/__tests__/validation.test.ts src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts src/contract/policyInsight/v1/__tests__/project.test.ts`

  Expected: PASS with stable pair/position canonical JSON and hash snapshots.

- [ ] **Step 7: Commit the contract runtime.**

  ```bash
  git add src/contract/policyInsight/v1/canonical.ts src/contract/policyInsight/v1/validate.ts src/contract/policyInsight/v1/project.ts src/contract/policyInsight/v1/__tests__
  git commit -m "m63: validate and project policy insight v1"
  ```

## Task 3: Add the canonical advisory reducer without changing persistence yet

**Files:**

- Modify: `src/engine/policy/synthesizePolicyInsight.ts`
- Modify: `src/engine/policy/reasoning.ts`
- Modify: `src/engine/policy/ruleset.ts`
- Modify: `src/engine/policy/__tests__/policyFixtures.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.v1.actions.test.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.v1.content.test.ts`

**Exported API changes:** Add `PolicyInsightContentDraft` and `synthesizePolicyInsightV1`; keep the legacy `synthesizePolicyInsight` export temporarily so this task remains typecheckable, then remove it during the vertical cutover in Task 4.

**Behavioral invariants (write these named tests first):**

- `maps hard-stale market data to STAND_DOWN before all other actions`.
- `maps blocked suitability and active churn stand-down to STAND_DOWN`.
- `maps a qualified lower-bound breach to EXIT_TO_USDC`.
- `maps a qualified upper-bound breach to EXIT_TO_SOL`.
- `maps an unqualified lower observation to MONITOR_LOWER_BOUND`.
- `maps an unqualified upper observation to MONITOR_UPPER_BOUND`.
- `maps pair-scoped and in-range advice with no higher guard to HOLD`.
- `maps integer deployment percentages to exact basis points and rejects invalid transitional values`.
- `maps low medium and high confidence to 2500 5000 and 7500 basis points`.
- `emits only selected non-audit bundle and source references in canonical tuple order`.
- `emits descending supports and ascending resistances from eligible structured price evidence only`.
- `emits empty level arrays and NO_ELIGIBLE_PRICE_LEVELS instead of fallback prices`.
- `orders reason codes by ruleset precedence and warnings by code then message`.
- `renders bounded deterministic reasoning without copying research prose`.
- `maps worst authoritative quality to STALE PARTIAL or COMPLETE`.

- [ ] **Step 1: Create the two focused failing test files.** Put the seven action transitions in `synthesizePolicyInsight.v1.actions.test.ts`; put numeric, levels, evidence, ordering, quality, and reasoning cases in `synthesizePolicyInsight.v1.content.test.ts`. Reuse fixed builders from `policyFixtures.ts`; do not add wall-clock calls.

- [ ] **Step 2: Run the new reducer tests and confirm the canonical reducer is missing.**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.v1.actions.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.v1.content.test.ts`

  Expected: FAIL because `synthesizePolicyInsightV1` is not exported.

- [ ] **Step 3: Add a canonical content-draft reducer.** Return every immutable `PolicyInsightContent` field except application-owned `insightId`. Emit uppercase canonical enums directly at the decision point, preserve hard-stale/stand-down precedence, convert transitional integer percentage/confidence values with exact checked mappings, and derive timestamps in canonical millisecond UTC format.

  ```ts
  export type PolicyInsightContentDraft = Omit<PolicyInsightContent, "insightId">;

  export function synthesizePolicyInsightV1(
    envelope: PolicySynthesisEnvelope,
    ruleset: PolicyRuleset
  ): PolicyInsightContentDraft;
  ```

- [ ] **Step 4: Project evidence, levels, reasons, warnings, and reasoning deterministically.** Deduplicate references by their full identity tuple, include only selected lineage, compare/sort decimal strings exactly, remove `[100]`/`[200]` fallbacks, map selection status and data quality explicitly, and centralize reason precedence in `ruleset.ts`. Reject bad intermediate numbers rather than normalizing them.

- [ ] **Step 5: Run focused and legacy reducer tests.**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.v1.actions.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.v1.content.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.findings.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts src/engine/policy/__tests__/ruleset.test.ts`

  Expected: PASS; the temporary legacy export remains behaviorally unchanged until Task 4.

- [ ] **Step 6: Commit the canonical reducer.**

  ```bash
  git add src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/reasoning.ts src/engine/policy/ruleset.ts src/engine/policy/__tests__
  git commit -m "m63: add canonical policy insight reducer"
  ```

## Task 4: Cut synthesis, persistence, current/history reads, and OpenAPI over atomically

This is one vertical task because changing the required record shape on `PolicyInsightRepositoryPort` without its PostgreSQL implementation and all read/write callers would fail the automatic workspace typecheck gate. Do not split the port, adapter, or endpoint cutover into layer-only commits.

**Files:**

- Create: `drizzle/0007_mark_policy_insight_wire_contract.sql`
- Create: `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/ledger/pg/schema/policyInsights.ts`
- Create: `src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts`
- Modify: `src/application/ports/policyInsightRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts`
- Modify: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/getCurrentPolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/getPolicyInsightHistoryUseCase.ts`
- Modify: `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`
- Modify: `src/engine/policy/synthesizePolicyInsight.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.findings.test.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`
- Modify: `src/adapters/http/handlers/insightsCurrent.ts`
- Modify: `src/adapters/http/handlers/insightsHistory.ts`
- Modify: `src/adapters/http/openapi.ts`
- Modify: `src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`
- Modify: `src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`
- Create: `src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts`

**Exported API changes:** Change the required member shapes of the exported `policyInsights` table object and its inferred `PolicyInsightRow` and `PolicyInsightInsert` types (adding `wireContractSha256`), change the required member shapes of `NewPolicyInsightRecord` and `StoredPolicyInsight`, update `PolicyInsightRepositoryPort` inputs to carry the supported wire-contract digest, change `SynthesizePolicyInsightUseCase`, `GetCurrentPolicyInsightUseCase`, and `GetPolicyInsightHistoryUseCase` result types to canonical generated types, and remove the temporary legacy `synthesizePolicyInsight` export after all callers use `synthesizePolicyInsightV1`. No repository method is added without its PostgreSQL implementation in this task.

**Behavioral invariants (write these named tests first):**

- `leaves legacy rows unmodified with a null wire contract digest`.
- `inserts every new canonical row with the exact published schema digest`.
- `allows one canonical row beside a legacy row with the same synthesis input hash`.
- `returns an existing canonical row for a replay with the same digest ruleset and input hash`.
- `never returns an unmarked legacy row from current or history`.
- `orders canonical history by generatedAtUnixMs then id descending without gaps or duplicates`.
- `rejects a marked row whose content schema canonical bytes or hash are corrupt`.
- `returns 404 when a scope has only legacy rows`.
- `uses the injected current-read instant for evaluatedAt status and ageSeconds`.
- `uses one injected history-read instant for queriedAt and every item freshness`.
- `marks current and history items stale at the exact expiry boundary`.
- `keeps current and the first history item identical at the same query instant`.
- `accepts history limits through 100 and rejects 101`.
- `returns canonical items without payloadHash receivedAtIso legacy status or old field names`.
- `preserves existing 400 404 500 and 503 generic error envelopes`.
- `references the published root and history definition and uses published examples in OpenAPI`.

- [ ] **Step 1: Write the migration, repository, use-case, HTTP, and OpenAPI tests named above before changing production code.** Extend the existing focused files by their current responsibility; put schema migration shape checks in the new migration test and OpenAPI identity/example checks in the new OpenAPI test. The affected existing test files are below 500 lines; this task is a vertical implementation cutover rather than a test-only update.

- [ ] **Step 2: Run the non-PostgreSQL slice and confirm it fails on the legacy response and record types.**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts`

  Expected: FAIL because current code returns legacy content, handler-owned freshness, and handwritten OpenAPI schemas.

- [ ] **Step 3: Add the additive migration and matching Drizzle metadata.** Add nullable `wire_contract_sha256 varchar(64)`, a digest-format check allowing null, drop/replace `uniq_policy_insights_synthesis_input` with uniqueness over `(schema_version, wire_contract_sha256, ruleset_version, synthesis_input_hash)`, and update current/history indexes for `(pair, scope_key, generated_at_unix_ms, id)` filtering. Do not update existing rows or their JSON/hashes.

- [ ] **Step 4: Change the port and PostgreSQL adapter in the same edit.** Make canonical write records require `wireContractSha256` and `PolicyInsightContent`; make loaded canonical records expose validated immutable content. Pass the digest into replay lookup, inserts, conflict lookup, current, and history. Filter reads on both `schema_version = 'policy-insight.v1'` and the supported digest. On row load, call `parsePolicyInsightContent`, recompute canonical bytes/hash, and throw `PolicyInsightValidationError` on mismatch before returning any data.

  The logical port shape is:

  ```ts
  interface NewPolicyInsightRecord {
    readonly wireContractSha256: string;
    readonly synthesisOutputJson: PolicyInsightContent;
    // existing immutable audit/fingerprint fields remain
  }

  repository.findBySynthesisInputHash({
    schemaVersion,
    wireContractSha256,
    rulesetVersion,
    synthesisInputHash
  });
  ```

- [ ] **Step 5: Cut synthesis over to canonical content.** Call `synthesizePolicyInsightV1`, add the precomputed `insightId`, parse the completed `PolicyInsightContent`, hash that content, and persist the exact schema digest. Remove all new-code imports of `InsightIngestRequest`, `parseInsightIngestRequest`, and `computeInsightCanonicalAndHash`. Preserve selected/excluded audit lineage internally. Remove the temporary legacy reducer export only after all tests/callers use the canonical function.

- [ ] **Step 6: Move freshness into the read use cases.** Current captures the clock once and returns `projectPolicyInsightRead(record.synthesisOutputJson, queriedAtUnixMs)`. History captures once, projects every record with the same instant, returns canonical `queriedAt`, `limit`, `items`, and opaque `nextCursor`, and validates the envelope. No handler may call `Date.now()` or infer policy fields.

- [ ] **Step 7: Make handlers transport-only and align pagination.** Current sends the use-case item unchanged. History sets `nextCursor` from the repository cursor, validates/sends the canonical envelope, and caps `limit` at 100. Keep generic error envelopes at schema `1.0` because they are outside PolicyInsight success payloads.

- [ ] **Step 8: Replace handwritten OpenAPI success shapes.** Import the JSON Schema and valid fixtures once. Register `PolicyInsightRead` from the root definition and `PolicyInsightHistoryResponse` from `$defs`, point current/history 200 responses at those components, and load examples from `current-pair.json` and `history.json`. Do not retain parallel field-by-field PolicyInsight success schemas.

- [ ] **Step 9: Run the focused unit/contract slice.**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.findings.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts`

  Expected: PASS with no legacy PolicyInsight success fields.

- [ ] **Step 10: Run the focused PostgreSQL slice when `DATABASE_URL` is configured.**

  Run: `pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`

  Expected: PASS against a migrated disposable test database. If `DATABASE_URL` is absent, the established `skipIf` guards report the PG cases as skipped; do not substitute a production database.

- [ ] **Step 11: Commit the atomic vertical cutover.**

  ```bash
  git add drizzle/0007_mark_policy_insight_wire_contract.sql drizzle/meta src/ledger/pg/schema/policyInsights.ts src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres src/application/use-cases src/engine/policy src/adapters/http/handlers/insightsCurrent.ts src/adapters/http/handlers/insightsHistory.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts
  git commit -m "m63: serve canonical policy insight v1"
  ```

## Task 5: Ship the contract assets and downstream handoff documentation

**Files:**

- Modify: `scripts/copyBuildAssets.mjs`
- Create: `docs/contracts/policy-insight.v1.md`

- [ ] **Step 1: Add a failing build-asset assertion to the existing copy script workflow.** Extend `copyBuildAssets.mjs` with a post-copy existence/digest check for `dist/contracts/policy-insight/v1/policy-insight.schema.json`, `schema.sha256`, and all fixture suites. The script must fail if copied schema bytes do not match the published digest.

- [ ] **Step 2: Copy the entire versioned contract directory.** Reuse `copyDirectoryRecursive` with:

  ```js
  const policyInsightSource = resolve(projectRoot, "contracts/policy-insight/v1");
  const policyInsightDest = resolve(projectRoot, "dist/contracts/policy-insight/v1");
  copyDirectoryRecursive(policyInsightSource, policyInsightDest);
  ```

- [ ] **Step 3: Write the consumer contract guide.** Document every field, enum, unit, nullability and ordering rule; semantic validation limits; immutable-content hashing boundary; freshness formula and exclusive expiry; advisory-only authority; source/dist paths; `policy-insight.v1`; exact schema SHA-256 from `schema.sha256`; generate/check commands; legacy-row exclusion and temporary 404 rollout behavior; and the handoff tuple `(merged commit SHA, schema path, schema version, schema SHA-256)`. State that the merged commit SHA is recorded by the release/PR handoff after merge and is not embedded in the commit itself.

- [ ] **Step 4: Build and verify only the assets introduced by this task.**

  Run: `pnpm run build && test -f dist/contracts/policy-insight/v1/policy-insight.schema.json && test -f dist/contracts/policy-insight/v1/schema.sha256 && cmp contracts/policy-insight/v1/policy-insight.schema.json dist/contracts/policy-insight/v1/policy-insight.schema.json && cmp contracts/policy-insight/v1/schema.sha256 dist/contracts/policy-insight/v1/schema.sha256`

  Expected: PASS; source and dist schema/digest bytes are identical.

- [ ] **Step 5: Commit packaging and documentation.**

  ```bash
  git add scripts/copyBuildAssets.mjs docs/contracts/policy-insight.v1.md
  git commit -m "m63: document and package policy insight v1"
  ```

**Tests to add or update**

- Contract generation, fixture coverage, schema/digest drift, AJV/semantic validation, canonical-hash snapshots, and freshness projection tests under `src/contract/policyInsight/v1/__tests__/`.
- Canonical action-transition and content-mapping tests under `src/engine/policy/__tests__/`, followed by updates to the four existing synthesis suites.
- Migration and PostgreSQL repository tests for nullable legacy markers, digest-aware idempotency, canonical filtering/order, and corruption rejection.
- Application use-case tests for final content assembly and one-clock current/history freshness.
- PostgreSQL HTTP e2e tests for exact success payloads, 404/400/503 behavior, limit 100, expiry boundary, and pagination stability.
- OpenAPI contract tests proving the schema/components/examples are imported from published artifacts.

**Validation commands after all implementation tasks**

The dedicated validate phase, not a standalone implementation task, runs:

```bash
pnpm run contract:policy-insight:check
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
pnpm run boundaries
```

With a disposable local PostgreSQL database configured:

```bash
pnpm run test:pg
```

The PR records which commands ran and whether PG tests were executed or skipped for lack of a disposable database.

**Risk areas**

- The existing database schema already labels legacy JSON as `policy-insight.v1`; any query missing the digest predicate can leak the wrong wire shape.
- Replacing the old uniqueness rule incorrectly can either block the first canonical write beside legacy data or permit duplicate canonical rows.
- Dynamic freshness can accidentally enter the immutable hash or use multiple clock reads, producing nondeterministic current/history responses.
- JavaScript number comparison can corrupt decimal ordering; compare canonical decimal strings with arbitrary precision/string logic.
- Closed reason/warning enums and their ordering couple schema and reducer behavior; additions require an explicit new contract version, not a silent v1 relaxation.
- OpenAPI response serialization can drop fields if a handwritten old schema remains attached even when handler tests look correct.
- Immediately after rollout, installations with no marked row legitimately return 404; operational sequencing must synthesize and verify required scopes before downstream cutover.

**Stop conditions**

- Abort rather than continue if `design.md` and the actual evidence/selection types cannot identify selected versus audit-only lineage or structured `price_usdc_per_sol` inputs without inventing policy.
- Abort if the migration cannot preserve all existing rows byte-for-byte or requires backfilling `wire_contract_sha256`.
- Abort if digest-aware uniqueness cannot be installed safely because the live schema/index differs from repository migrations; inspect and resolve schema drift before writing data.
- Abort if any port/interface edit would be committed without all adapters/implementations and callers compiling in the same task.
- Abort if schema generation is nondeterministic across two consecutive `--write`/`--check` runs.
- Abort if a marked malformed row is partially serialized or silently repaired instead of failing closed.
- Abort if current/history success responses require retaining ambiguous aliases, numeric level coercion, or handler-side advisory inference.

**Plan self-review**

- Spec coverage: every issue acceptance criterion maps to Tasks 1-5; the persistence marker, no-backfill rule, advisory authority, exact freshness, OpenAPI reuse, and downstream pinning are explicit.
- Completeness scan: every code-changing step names concrete symbols, behavior, files, and focused commands; no deferred or generic implementation instructions remain.
- Type consistency: generated `PolicyInsightContent` is the immutable stored/hash type; `PolicyInsightRead` adds only freshness; `PolicyInsightHistoryResponse` owns `queriedAt`, `limit`, items, and nullable cursor. Task 4 keeps port and adapter signature changes atomic.
