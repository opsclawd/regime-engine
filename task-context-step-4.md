# Task Context: Task 4

Title: Document the raw-observations wire contract in OpenAPI
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-90
Repository: opsclawd/regime-engine
Branch: ai/issue-90
Start Commit: 328d6f19ce6af8533dfdf3d11fe585d193cbfc18

## Task Requirements

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

## Repository Targets

### Expected Files
- src/adapters/http/openapi.ts
- src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts

### Reference Files
- src/adapters/http/handlers/evidenceRaw.ts
- contracts/evidence-bundle/v1/evidence-bundle.schema.json

## Validation Commands

```bash
pnpm exec vitest run src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts src/adapters/http/__tests__/evidenceOpenApi.contract.test.ts
["pnpm","exec","eslint","src/adapters/http/openapi.ts","src/adapters/http/__tests__/evidenceRawOpenApi.contract.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **public OpenAPI operation**: The documented raw endpoint is GET-only, public, and has no request body. (Test: `documents GET /v1/evidence/sol-usdc/{id}/raw as a public operation`)
- **identifier parameter contract**: The required path string documents length bounds and numeric bundle-ID dispatch. (Test: `documents the bundle-id-or-run-id path parameter`)
- **success schema parity**: The 200 schema requires exactly the handler's envelope fields and object-valued items. (Test: `documents the exact raw observations success envelope`)
- **status documentation parity**: OpenAPI documents success, validation, absence, internal, and unavailable response families implemented by the handler. (Test: `documents every implemented raw-observation status`)
- **OpenAPI authority separation**: The operation remains a read-only evidence path and does not create an insights path or write operation. (Test: `keeps raw observations separate from evidence ingestion and policy insights`)

