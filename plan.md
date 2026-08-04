# Raw Evidence Observations API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a deterministic, read-only `GET /v1/evidence/sol-usdc/:id/raw` endpoint that accepts either a numeric evidence-bundle ID or a pipeline run ID and returns the matching rows from `intelligence.raw_observations`.

**Architecture:** Add a narrow application read port for the externally owned raw-observations table and extend the existing evidence repository with bundle-ID-to-run-ID lookup. A pure use case owns identifier interpretation and not-found behavior; a Postgres adapter owns cross-schema SQL; the Fastify handler owns wire validation and error mapping. Composition only enables the endpoint when PostgreSQL is configured, matching the existing evidence read endpoints.

**Tech Stack:** TypeScript 5.8, Fastify 5, Drizzle ORM raw SQL, PostgreSQL, Vitest, ESLint, OpenAPI 3.1.

---

**Goal and user-visible contract**

- Add public, unauthenticated `GET /v1/evidence/sol-usdc/:id/raw` alongside the existing evidence GET routes.
- Interpret an `:id` made entirely of decimal digits as a positive, safe-integer `regime_engine.evidence_bundles.id`; resolve that row's `run_id` before querying raw observations.
- Interpret any other non-empty identifier of at most 256 characters as a pipeline `runId` and query raw observations directly.
- Return `200` with `{ schemaVersion: "1.0", pair: "SOL/USDC", runId, items }`. `items` contains the full raw rows as JSON objects, deterministically ordered by their JSON representation; no ingestion or policy-authority claims are added.
- Return distinct `400`, `404`, `503`, and `500` error responses using the existing evidence error envelope.

**Non-goals**

- Do not write to `intelligence.raw_observations` or copy raw observations into the regime-engine schema.
- Do not define a Drizzle schema or migration for a table owned by `sol-usdc-clmm-intelligence`.
- Do not provision database grants, change startup schema verification, or make the raw endpoint a health-check dependency.
- Do not add pagination, filtering, multi-pair support, authentication, caching, retries, or raw observations to normal evidence ingestion responses.
- Do not change policy synthesis, evidence selection, canonical evidence hashing, or plan generation.

**Assumptions**

- `intelligence.raw_observations` exists in the same PostgreSQL database and exposes a `run_id` column equal to `regime_engine.evidence_bundles.run_id`.
- Rows can be converted with PostgreSQL `to_jsonb`; this deliberately avoids taking ownership of the external table's column schema.
- Digit-only pipeline run IDs are reserved by the route contract for bundle-ID lookup. A caller with a digit-only pipeline run ID must use its evidence bundle ID instead.
- A valid bundle with no matching raw observations is a not-found result, not an empty success, because the endpoint identifies one evidence lineage.
- Existing read endpoints are public, so this observability endpoint is also public. If raw rows contain secrets or sensitive source payloads, implementation must stop for an authorization/redaction decision.

**Affected files (repository-relative full paths)**

- Create `src/application/ports/rawObservationsReadPort.ts` — opaque JSON-row read contract for the external schema.
- Modify `src/application/ports/evidenceBundleRepositoryPort.ts` — add bundle-ID-to-run-ID lookup.
- Create `src/adapters/postgres/postgresRawObservationsReadAdapter.ts` — parameterized cross-schema query and deterministic row ordering.
- Modify `src/adapters/postgres/postgresEvidenceBundleRepository.ts` — implement the new lookup method.
- Create `src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts` — raw-reader query, ordering, empty, and failure tests.
- Create `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts` — focused lookup tests without growing the existing large repository suites.
- Modify `src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts` — update fake EvidenceBundleRepositoryPort implementation.
- Modify `src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts` — update fake EvidenceBundleRepositoryPort implementation.
- Modify `src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts` — update fake EvidenceBundleRepositoryPort implementation.
- Modify `src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts` — update fake EvidenceBundleRepositoryPort implementation.
- Modify `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts` — update fake EvidenceBundleRepositoryPort implementation.
- Modify `src/application/errors/evidenceErrors.ts` — validation and not-found error taxonomy used by the use case and handler.
- Create `src/application/use-cases/getRawObservationsForBundleUseCase.ts` — identifier dispatch and lineage lookup orchestration.
- Create `src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts` — branch and error tests written first.
- Create `src/adapters/http/handlers/evidenceRaw.ts` — Fastify parameter handling and response/error mapping.
- Create `src/adapters/http/handlers/__tests__/evidenceRaw.test.ts` — handler contract tests.
- Modify `src/adapters/http/routes.ts` — route dependency and registration.
- Modify `src/composition/buildApplication.ts` — construct and expose the adapter/use case when PostgreSQL exists.
- Modify `src/composition/__tests__/evidenceSelectionWiring.test.ts` — verify PostgreSQL-gated composition.
- Modify `src/composition/__tests__/evidenceRoutes.e2e.test.ts` — verify the registered route's no-database behavior and separation from insights.
- Modify `src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts` — keep its exhaustive `HttpRouteDependencies` test fixture structurally current.
- Modify `src/adapters/http/openapi.ts` — document the path, parameter, response, and raw-row schemas.
- Create `src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts` — focused OpenAPI assertions instead of expanding the existing test file with more than ten cases.

## Task 1: Add the raw-observation and bundle-resolution persistence ports

**Files:**

- Create: `src/application/ports/rawObservationsReadPort.ts`
- Modify: `src/application/ports/evidenceBundleRepositoryPort.ts`
- Create: `src/adapters/postgres/postgresRawObservationsReadAdapter.ts`
- Modify: `src/adapters/postgres/postgresEvidenceBundleRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts`
- Create: `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts`
- Modify: `src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`
- Reference only: `src/ledger/pg/db.ts`
- Reference only: `src/ledger/pg/schema/evidenceBundles.ts`
- Reference only: `src/application/errors/evidenceErrors.ts`

**Behavioral invariants (write these named tests first):**

1. `returns raw observations for a run id in deterministic JSON order`: the adapter parameterizes `runId`, converts each external row with `to_jsonb`, and returns the same JSON ordering regardless of database insertion order.
2. `returns an empty list when a run id has no raw observations`: zero external rows produce `[]`; absence interpretation remains in the use case.
3. `rejects malformed raw-observation rows as unavailable`: any selected value that is null, an array, or a scalar is not allowed through the port as a JSON object.
4. `maps raw-observation query failures to EvidenceStoreUnavailableError`: connection, missing-schema/table, permission, or row-shape failures are isolated as an evidence-store availability failure with the original cause.
5. `resolves an existing evidence bundle id to its run id`: the evidence repository reads one `run_id` for the exact numeric primary key.
6. `returns null when an evidence bundle id does not exist`: no matching regime-engine row returns `null`.
7. `maps transient bundle-id lookup failures to EvidenceStoreUnavailableError`: the new repository method follows the existing transient-failure policy.

- [ ] **Step 1: Write focused failing adapter tests**

  Build typed `Db` doubles whose `execute` method captures the Drizzle SQL object and returns representative rows. Assert exact result objects, empty results, deterministic ordering, malformed row rejection, availability translation, `run_id` coercion to string, and `null` for no evidence bundle. Name the test cases exactly as the invariants above.

- [ ] **Step 2: Run the new adapter tests and confirm the missing modules/method fail**

  Run: `pnpm exec vitest run src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts`

  Expected: FAIL because `rawObservationsReadPort.ts`, `postgresRawObservationsReadAdapter.ts`, and `EvidenceBundleRepositoryPort.getRunIdById` do not exist.

- [ ] **Step 3: Define both ports and implement every affected Postgres adapter in this same task**

  Add this application-facing shape in `rawObservationsReadPort.ts`:

  ```ts
  export type RawObservation = Readonly<Record<string, unknown>>;

  export interface RawObservationsReadPort {
    getByRunId(runId: string): Promise<readonly RawObservation[]>;
  }
  ```

  Add this method to `EvidenceBundleRepositoryPort` and implement it in `createPostgresEvidenceBundleRepository` before leaving the task:

  ```ts
  getRunIdById(id: number): Promise<string | null>;
  ```

  Its query must select only `evidenceBundles.runId`, filter with `eq(evidenceBundles.id, id)`, limit to one row, return `null` when absent, and reuse the repository's existing transient Postgres error translation.

  Update fake `EvidenceBundleRepositoryPort` implementations in `getCurrentEvidenceUseCase.test.ts`, `getEvidenceHistoryUseCase.test.ts`, `ingestEvidenceBundleUseCase.test.ts`, `requestPositionPolicyInsightSynthesisUseCase.test.ts`, and `selectEvidenceForSynthesisUseCase.test.ts` to include `getRunIdById` (e.g. returning `null` or a stubbed run ID) so that workspace type checks pass.

  Implement `createPostgresRawObservationsReadAdapter(db: Db): RawObservationsReadPort` with a parameterized query equivalent to:

  ```sql
  SELECT to_jsonb(raw_observation) AS observation
  FROM intelligence.raw_observations AS raw_observation
  WHERE raw_observation.run_id = ${runId}
  ORDER BY to_jsonb(raw_observation)::text
  ```

  Validate that each returned `observation` is a non-null, non-array object before returning it. Wrap query and row-shape errors in `EvidenceStoreUnavailableError` with `{ cause: error }`, because this adapter crosses an externally owned schema and its failures must not leak database details.

- [ ] **Step 4: Run scoped adapter tests and lint**

  Run: `pnpm exec vitest run src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts`

  Expected: PASS with all seven named invariants covered.

  Run: `pnpm exec eslint src/application/ports/rawObservationsReadPort.ts src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresRawObservationsReadAdapter.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Expected: exit 0 with no warnings.

- [ ] **Step 5: Commit the persistence boundary**

  ```bash
  git add src/application/ports/rawObservationsReadPort.ts src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresRawObservationsReadAdapter.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts
  git commit -m "m90: add raw observation read adapters"
  ```

## Task 2: Orchestrate bundle ID and run ID resolution in the use case

**Files:**

- Modify: `src/application/errors/evidenceErrors.ts`
- Create: `src/application/use-cases/getRawObservationsForBundleUseCase.ts`
- Create: `src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts`
- Reference only: `src/application/ports/rawObservationsReadPort.ts`
- Reference only: `src/application/ports/evidenceBundleRepositoryPort.ts`

**Behavioral invariants (write these named tests first):**

1. `resolves a numeric identifier through the evidence bundle before reading observations`: for a positive safe-integer digit string, call `getRunIdById` once, then call `getByRunId` with the resolved value.
2. `uses a nonnumeric identifier directly as the pipeline run id`: do not call `getRunIdById`; pass the original identifier to `getByRunId` unchanged.
3. `rejects invalid numeric bundle identifiers before accessing either port`: `0`, unsafe integers, and noncanonical numeric forms that match the digit-only branch produce `RawObservationIdentifierValidationError` with no reads.
4. `rejects empty or overlong run identifiers before accessing either port`: a zero-length or greater-than-256-character identifier produces `RawObservationIdentifierValidationError`.
5. `reports a missing numeric bundle without querying raw observations`: a `null` bundle lookup produces `EvidenceBundleNotFoundError` and does not call `getByRunId`.
6. `reports missing observations for a resolved bundle run id`: an empty raw read produces `RawObservationsNotFoundError` containing the resolved run ID.
7. `reports missing observations for a direct run id`: an empty raw read produces the same not-found error containing the direct run ID.
8. `returns the resolved run id with observations without mutating them`: success returns `{ runId, items }` and preserves the adapter's deterministic item order and object values.

- [ ] **Step 1: Write the failing use-case tests with strict fakes**

  Define minimal fakes for `EvidenceBundleRepositoryPort.getRunIdById` and `RawObservationsReadPort.getByRunId`. Assert calls and no-calls as well as error classes, so numeric/direct dispatch cannot accidentally issue both queries.

- [ ] **Step 2: Run the use-case test and verify it fails**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts`

  Expected: FAIL because the use case and its errors do not exist.

- [ ] **Step 3: Add explicit application errors and minimal orchestration**

  Add exported `RawObservationIdentifierValidationError`, `EvidenceBundleNotFoundError`, and `RawObservationsNotFoundError` classes to `evidenceErrors.ts`. Each class must have a stable `name`; the two not-found errors must retain the missing bundle ID or resolved run ID as readonly context without exposing SQL details.

  Define and implement:

  ```ts
  export interface GetRawObservationsForBundleUseCaseDeps {
    evidenceRepository: EvidenceBundleRepositoryPort;
    rawObservations: RawObservationsReadPort;
  }

  export type GetRawObservationsForBundleUseCase = (input: { identifier: string }) => Promise<{
    runId: string;
    items: readonly RawObservation[];
  }>;
  ```

  Use `/^\d+$/` for the numeric branch, `Number.isSafeInteger(id) && id > 0` for bundle-ID validation, and the evidence contract's 256-character run-ID bound for the direct branch. Fetch observations only after a concrete run ID is available and turn an empty result into `RawObservationsNotFoundError`.

- [ ] **Step 4: Run scoped use-case tests and lint**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts`

  Expected: PASS with all eight named branch invariants.

  Run: `pnpm exec eslint src/application/errors/evidenceErrors.ts src/application/use-cases/getRawObservationsForBundleUseCase.ts src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts`

  Expected: exit 0 with no warnings.

- [ ] **Step 5: Commit the use case**

  ```bash
  git add src/application/errors/evidenceErrors.ts src/application/use-cases/getRawObservationsForBundleUseCase.ts src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts
  git commit -m "m90: resolve raw observations by bundle or run id"
  ```

## Task 3: Expose and compose the raw-observations HTTP route

**Files:**

- Create: `src/adapters/http/handlers/evidenceRaw.ts`
- Create: `src/adapters/http/handlers/__tests__/evidenceRaw.test.ts`
- Modify: `src/adapters/http/routes.ts`
- Modify: `src/composition/buildApplication.ts`
- Modify: `src/composition/__tests__/evidenceSelectionWiring.test.ts`
- Modify: `src/composition/__tests__/evidenceRoutes.e2e.test.ts`
- Modify: `src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`
- Reference only: `src/adapters/http/evidenceHttp.ts`
- Reference only: `src/composition/buildApp.ts`

**Behavioral invariants (write these named tests first):**

1. `returns 200 with the resolved run id and deterministic raw items`: pass the decoded `params.id` to the use case and emit exactly `schemaVersion`, `pair`, `runId`, and `items`.
2. `returns 400 VALIDATION_ERROR for an invalid identifier`: map `RawObservationIdentifierValidationError` to the standard evidence envelope without calling storage directly.
3. `returns 404 EVIDENCE_BUNDLE_NOT_FOUND for an unknown numeric bundle id`: preserve the distinction between a missing bundle and missing external observations.
4. `returns 404 RAW_OBSERVATIONS_NOT_FOUND when the run exists but has no raw rows`: apply this to both resolved and direct run IDs.
5. `returns 503 EVIDENCE_STORE_UNAVAILABLE when PostgreSQL is not configured`: a null use case fails before parameter parsing.
6. `returns 503 EVIDENCE_STORE_UNAVAILABLE for cross-schema read failures`: map `EvidenceStoreUnavailableError` without exposing its cause.
7. `returns 500 INTERNAL_ERROR for unexpected failures`: log the error and return a generic message.
8. `wires raw observation reads only when PostgreSQL is configured`: `buildApplication` returns null without `ctx.pg` and a callable use case with it.
9. `registers raw evidence separately from policy insight routes`: the concrete route exists and does not change the legacy insights handlers.

- [ ] **Step 1: Write failing handler and composition/route tests**

  In the new handler test, register only `/:id/raw` on a local Fastify instance and exercise every status mapping. Extend the two existing evidence composition suites only with their relevant PostgreSQL-gating and route-separation assertions. Add `getRawObservationsForBundle: null` to the typed dummy dependency object in `positionSynthesisRequestRoutes.e2e.test.ts`; this is a structural consumer update, not new position-synthesis behavior.

- [ ] **Step 2: Run the scoped HTTP/composition tests and confirm failure**

  Run: `pnpm exec vitest run src/adapters/http/handlers/__tests__/evidenceRaw.test.ts src/composition/__tests__/evidenceSelectionWiring.test.ts src/composition/__tests__/evidenceRoutes.e2e.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`

  Expected: FAIL because the handler, dependency member, composition, and route do not exist.

- [ ] **Step 3: Implement the handler, update both dependency interfaces, and wire all implementations together**

  Implement `createEvidenceRawHandler(useCase: GetRawObservationsForBundleUseCase | null)` with Fastify params typed as `{ id?: string }`. On success send:

  ```ts
  return reply.code(200).send({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    pair: "SOL/USDC",
    runId: result.runId,
    items: result.items
  });
  ```

  Map the named errors to `VALIDATION_ERROR`, `EVIDENCE_BUNDLE_NOT_FOUND`, `RAW_OBSERVATIONS_NOT_FOUND`, `EVIDENCE_STORE_UNAVAILABLE`, and `INTERNAL_ERROR` with the same `{ schemaVersion, error: { code, message, details: [] } }` envelope used by existing evidence handlers.

  In this same implementation step, add `getRawObservationsForBundle: GetRawObservationsForBundleUseCase | null` to both exported dependency interfaces:
  - `ApplicationDependencies` in `src/composition/buildApplication.ts`
  - `HttpRouteDependencies` in `src/adapters/http/routes.ts`

  In `buildApplication`, construct one `createPostgresRawObservationsReadAdapter(ctx.pg)` and one `createGetRawObservationsForBundleUseCase({ evidenceRepository, rawObservations })` only when `ctx.pg` and the evidence repository exist; otherwise expose `null`. Return the member in the application dependency object. In `registerRoutes`, register:

  ```ts
  app.get(
    "/v1/evidence/sol-usdc/:id/raw",
    createEvidenceRawHandler(deps.getRawObservationsForBundle)
  );
  ```

  Keep this after the fixed `/current` and `/history` evidence routes for readability, even though Fastify resolves static and parameter routes safely.

- [ ] **Step 4: Run scoped HTTP/composition tests and lint**

  Run: `pnpm exec vitest run src/adapters/http/handlers/__tests__/evidenceRaw.test.ts src/composition/__tests__/evidenceSelectionWiring.test.ts src/composition/__tests__/evidenceRoutes.e2e.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`

  Expected: PASS with the nine named handler/wiring invariants and all pre-existing cases in those files.

  Run: `pnpm exec eslint src/adapters/http/handlers/evidenceRaw.ts src/adapters/http/handlers/__tests__/evidenceRaw.test.ts src/adapters/http/routes.ts src/composition/buildApplication.ts src/composition/__tests__/evidenceSelectionWiring.test.ts src/composition/__tests__/evidenceRoutes.e2e.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts`

  Expected: exit 0 with no warnings.

- [ ] **Step 5: Commit the HTTP route and composition**

  ```bash
  git add src/adapters/http/handlers/evidenceRaw.ts src/adapters/http/handlers/__tests__/evidenceRaw.test.ts src/adapters/http/routes.ts src/composition/buildApplication.ts src/composition/__tests__/evidenceSelectionWiring.test.ts src/composition/__tests__/evidenceRoutes.e2e.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts
  git commit -m "m90: expose raw evidence observations endpoint"
  ```

## Task 4: Document the raw-observations wire contract in OpenAPI

**Files:**

- Modify: `src/adapters/http/openapi.ts`
- Create: `src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts`
- Reference only: `src/adapters/http/handlers/evidenceRaw.ts`
- Reference only: `contracts/evidence-bundle/v1/evidence-bundle.schema.json`

**Behavioral invariants (write these named tests first):**

1. `documents GET /v1/evidence/sol-usdc/{id}/raw as a public operation`: the path exists, has `security: []`, and has no request body.
2. `documents the bundle-id-or-run-id path parameter`: `id` is required, is in `path`, and is a string with length 1 through 256 and a description of numeric dispatch.
3. `documents the exact raw observations success envelope`: the `200` schema requires `schemaVersion`, fixed pair, `runId`, and an `items` array whose entries are unconstrained JSON objects.
4. `documents every implemented raw-observation status`: responses contain exactly the implemented success plus `400`, `404`, `500`, and `503` error families.
5. `keeps raw observations separate from evidence ingestion and policy insights`: the new operation is GET-only and does not add the path under `/v1/insights`.

- [ ] **Step 1: Write the focused failing OpenAPI contract test**

  Create a new test file rather than adding cases to `evidenceOpenApi.contract.test.ts`, which already exceeds ten test cases. Assert the path parameter, empty security array, response keys, component references, required response properties, and object-valued `items` schema named above.

- [ ] **Step 2: Run the new OpenAPI test and confirm failure**

  Run: `pnpm exec vitest run src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts`

  Expected: FAIL because `/v1/evidence/sol-usdc/{id}/raw` and its response schema are absent.

- [ ] **Step 3: Add the OpenAPI components and path**

  In `buildOpenApiDocument`, add `RawObservation` as `{ type: "object", additionalProperties: true }` and `RawObservationsResponse` as an object requiring `schemaVersion`, `pair`, `runId`, and `items`. Add a public GET operation at `/v1/evidence/sol-usdc/{id}/raw` with the required path parameter, a `200` reference to `RawObservationsResponse`, `400` validation, `404` bundle-or-observation absence, `500` internal error, and `503` store-unavailable responses using `EvidenceError` where applicable. Ensure examples use the exact handler field names.

- [ ] **Step 4: Run scoped OpenAPI tests and lint**

  Run: `pnpm exec vitest run src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts src/adapters/http/__tests__/evidenceOpenApi.contract.test.ts`

  Expected: PASS; the new focused contract and every existing evidence contract remain valid.

  Run: `pnpm exec eslint src/adapters/http/openapi.ts src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts`

  Expected: exit 0 with no warnings.

- [ ] **Step 5: Commit the documented API contract**

  ```bash
  git add src/adapters/http/openapi.ts src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts
  git commit -m "m90: document raw evidence observations api"
  ```

**Tests to add or update**

- New adapter tests prove parameterized cross-schema lookup, deterministic row ordering, malformed-row isolation, availability translation, and bundle-ID resolution.
- New use-case tests prove every numeric/direct dispatch transition, validation boundary, not-found distinction, and successful result shape.
- New handler tests prove the wire envelope and every HTTP status mapping.
- Existing composition tests gain only PostgreSQL-gating, route-presence, and typed-fixture updates.
- A new focused OpenAPI test avoids expanding `src/adapters/http/__tests__/evidenceOpenApi.contract.test.ts`, which already has more than ten cases.
- No database migration test is added because this repository does not own `intelligence.raw_observations`.

**Dedicated validation phase (after all implementation tasks; not a standalone implementation task)**

Run the focused feature suite first:

```bash
pnpm exec vitest run src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts src/adapters/http/handlers/__tests__/evidenceRaw.test.ts src/composition/__tests__/evidenceSelectionWiring.test.ts src/composition/__tests__/evidenceRoutes.e2e.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts src/adapters/http/__tests__/evidenceOpenApi.contract.test.ts
```

Expected: all selected tests pass with no skipped unit or HTTP tests. PostgreSQL-independent adapter tests use doubles; they must not require an external `intelligence` schema.

Then run the repository quality gate required by `AGENTS.md`:

```bash
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build
```

Expected: all four commands exit 0. The implementation loop also runs its automatic workspace-wide `pnpm -r typecheck` after every task; port/interface additions and all their adapters/typed consumers are deliberately grouped so that gate remains green.

If a test database with the externally owned schema is available, run this optional integration smoke check after confirming cleanup cannot alter non-test rows:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts
```

The default plan does not require or create external-schema fixtures; unit doubles remain the authoritative automated coverage unless the owning repository provides a safe shared test fixture.

**Risk areas**

- Cross-schema coupling is runtime-only: a table or column rename, revoked `SELECT`, or unavailable schema will not be caught by TypeScript. The adapter must contain the dependency and translate it to `503`.
- Returning whole external rows can expose newly added columns automatically. Confirm the table is safe for an unauthenticated observability endpoint; otherwise add an explicit allowlist only after a product/security decision.
- Numeric dispatch makes digit-only run IDs ambiguous. This plan resolves them as bundle IDs consistently and documents that rule.
- Raw rows can be large. The issue explicitly avoids adding them to ingestion but does not specify pagination or a response limit; monitor response size and latency without inventing pagination in this change.
- Deterministic ordering uses JSON text rather than an assumed external primary key. Duplicate identical rows remain indistinguishable but serialize identically, which is sufficient for deterministic output.
- PostgreSQL JSON conversion can represent timestamps and large numerics differently from JavaScript-native values. Returning `to_jsonb` keeps conversion at the database boundary and avoids unsafe `bigint` serialization.
- Adding required members to `ApplicationDependencies` and `HttpRouteDependencies` affects typed test fixtures; all known concrete/fixture consumers are included in Task 3.

**Stop conditions**

- Stop if `intelligence.raw_observations` does not have a `run_id` that matches evidence-bundle `runId`; do not guess a replacement join key.
- Stop if raw rows contain credentials, private prompts, personal data, licensed content, or other fields unsuitable for an unauthenticated response; obtain an explicit redaction/authentication contract first.
- Stop if the production PostgreSQL role cannot receive read-only `SELECT` access through the owning IaC/DBA process; do not add grants or ownership changes in this repository.
- Stop if the external row cannot be converted to JSON without lossy or failing values; agree on an explicit response projection with the owning service rather than silently dropping fields.
- Stop if callers require digit-only pipeline run IDs to remain directly addressable; the path needs an explicit discriminator rather than heuristic dispatch.
- Stop if implementation reveals another concrete adapter for either changed port/interface that is not listed here; update the task boundary so the port and every implementation change land together before coding onward.
- Stop rather than modify migrations, generated contracts, policy logic, or external repositories, because those changes are outside this issue's approved scope.

**Self-review outcome**

- Spec coverage: every acceptance criterion maps to Tasks 1 through 4; the endpoint is backed by a port, adapter, use case, handler, composition, tests, and OpenAPI.
- Placeholder scan: the plan contains no deferred implementation or unspecified edge-case steps.
- Type consistency: `getRunIdById`, `getByRunId`, `GetRawObservationsForBundleUseCase`, `getRawObservationsForBundle`, `runId`, and `items` are used consistently across tasks.
- Risk classification: this is a read-only query flow with no retry/recovery loop, explicit state machine, or irreversible side effect, so `<!-- plan-review-required -->` is intentionally omitted.
