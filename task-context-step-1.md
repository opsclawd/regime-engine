# Task Context: Task 1

Title: Add the raw-observation and bundle-resolution persistence ports
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

## Repository Targets

### Expected Files
- src/application/ports/rawObservationsReadPort.ts
- src/application/ports/evidenceBundleRepositoryPort.ts
- src/adapters/postgres/postgresRawObservationsReadAdapter.ts
- src/adapters/postgres/postgresEvidenceBundleRepository.ts
- src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts
- src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts
- src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts
- src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts
- src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts
- src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts
- src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts

### Reference Files
- src/ledger/pg/db.ts
- src/ledger/pg/schema/evidenceBundles.ts
- src/application/errors/evidenceErrors.ts

## Validation Commands

```bash
pnpm exec vitest run src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts
["pnpm","exec","eslint","src/application/ports/rawObservationsReadPort.ts","src/application/ports/evidenceBundleRepositoryPort.ts","src/adapters/postgres/postgresRawObservationsReadAdapter.ts","src/adapters/postgres/postgresEvidenceBundleRepository.ts","src/adapters/postgres/__tests__/postgresRawObservationsReadAdapter.test.ts","src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.runId.test.ts","src/application/use-cases/__tests__/getCurrentEvidenceUseCase.test.ts","src/application/use-cases/__tests__/getEvidenceHistoryUseCase.test.ts","src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts","src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts","src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **deterministic raw row order**: A run ID query returns full JSON objects in deterministic JSON-text order regardless of insertion order. (Test: `returns raw observations for a run id in deterministic JSON order`)
- **empty raw read**: A run ID with no external rows returns an empty array from the persistence port. (Test: `returns an empty list when a run id has no raw observations`)
- **raw row shape isolation**: Null, array, and scalar raw values cannot cross the port as observation objects. (Test: `rejects malformed raw-observation rows as unavailable`)
- **cross-schema failure isolation**: Raw query and row-shape failures become EvidenceStoreUnavailableError with their cause retained internally. (Test: `maps raw-observation query failures to EvidenceStoreUnavailableError`)
- **bundle run resolution**: An existing numeric evidence bundle primary key resolves to exactly its stored run ID. (Test: `resolves an existing evidence bundle id to its run id`)
- **missing bundle lookup**: An unknown numeric evidence bundle primary key returns null from the repository. (Test: `returns null when an evidence bundle id does not exist`)
- **bundle lookup availability**: Transient database failure during bundle-ID resolution follows the existing evidence-store availability taxonomy. (Test: `maps transient bundle-id lookup failures to EvidenceStoreUnavailableError`)

