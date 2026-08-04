# Task Context: Task 3

Title: Expose and compose the raw-observations HTTP route
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

## Repository Targets

### Expected Files
- src/adapters/http/handlers/evidenceRaw.ts
- src/adapters/http/handlers/__tests__/evidenceRaw.test.ts
- src/adapters/http/routes.ts
- src/composition/buildApplication.ts
- src/composition/__tests__/evidenceSelectionWiring.test.ts
- src/composition/__tests__/evidenceRoutes.e2e.test.ts
- src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts

### Reference Files
- src/adapters/http/evidenceHttp.ts
- src/composition/buildApp.ts

## Validation Commands

```bash
pnpm exec vitest run src/adapters/http/handlers/__tests__/evidenceRaw.test.ts src/composition/__tests__/evidenceSelectionWiring.test.ts src/composition/__tests__/evidenceRoutes.e2e.test.ts src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts
["pnpm","exec","eslint","src/adapters/http/handlers/evidenceRaw.ts","src/adapters/http/handlers/__tests__/evidenceRaw.test.ts","src/adapters/http/routes.ts","src/composition/buildApplication.ts","src/composition/__tests__/evidenceSelectionWiring.test.ts","src/composition/__tests__/evidenceRoutes.e2e.test.ts","src/composition/__tests__/positionSynthesisRequestRoutes.e2e.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **raw endpoint success envelope**: The handler forwards the decoded path ID and returns only schemaVersion, pair, resolved runId, and deterministic items. (Test: `returns 200 with the resolved run id and deterministic raw items`)
- **identifier error mapping**: Application identifier validation failures map to HTTP 400 with the standard evidence error envelope. (Test: `returns 400 VALIDATION_ERROR for an invalid identifier`)
- **bundle absence mapping**: An unknown numeric bundle maps to HTTP 404 with EVIDENCE_BUNDLE_NOT_FOUND. (Test: `returns 404 EVIDENCE_BUNDLE_NOT_FOUND for an unknown numeric bundle id`)
- **raw observation absence mapping**: A concrete run ID without raw rows maps to HTTP 404 with RAW_OBSERVATIONS_NOT_FOUND. (Test: `returns 404 RAW_OBSERVATIONS_NOT_FOUND when the run exists but has no raw rows`)
- **unconfigured store mapping**: A null use case maps to HTTP 503 before parameter interpretation. (Test: `returns 503 EVIDENCE_STORE_UNAVAILABLE when PostgreSQL is not configured`)
- **cross-schema availability mapping**: EvidenceStoreUnavailableError maps to HTTP 503 without leaking its cause. (Test: `returns 503 EVIDENCE_STORE_UNAVAILABLE for cross-schema read failures`)
- **unexpected failure mapping**: Unknown exceptions are logged and map to a generic HTTP 500 response. (Test: `returns 500 INTERNAL_ERROR for unexpected failures`)
- **PostgreSQL-gated composition**: The use case is null without PostgreSQL and callable when PostgreSQL is configured. (Test: `wires raw observation reads only when PostgreSQL is configured`)
- **route authority separation**: The raw evidence route is registered under evidence and does not alter policy insight routes. (Test: `registers raw evidence separately from policy insight routes`)

