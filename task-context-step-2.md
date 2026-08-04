# Task Context: Task 2

Title: Orchestrate bundle ID and run ID resolution in the use case
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

## Repository Targets

### Expected Files
- src/application/errors/evidenceErrors.ts
- src/application/use-cases/getRawObservationsForBundleUseCase.ts
- src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts

### Reference Files
- src/application/ports/rawObservationsReadPort.ts
- src/application/ports/evidenceBundleRepositoryPort.ts

## Validation Commands

```bash
pnpm exec vitest run src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts
["pnpm","exec","eslint","src/application/errors/evidenceErrors.ts","src/application/use-cases/getRawObservationsForBundleUseCase.ts","src/application/use-cases/__tests__/getRawObservationsForBundleUseCase.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **numeric identifier dispatch**: A positive safe-integer digit string resolves through the evidence repository before the raw read. (Test: `resolves a numeric identifier through the evidence bundle before reading observations`)
- **direct run identifier dispatch**: A nonnumeric valid identifier bypasses bundle lookup and is used unchanged as the run ID. (Test: `uses a nonnumeric identifier directly as the pipeline run id`)
- **invalid numeric short circuit**: Zero, unsafe, or noncanonical digit-only bundle IDs fail before either persistence port is called. (Test: `rejects invalid numeric bundle identifiers before accessing either port`)
- **invalid run identifier short circuit**: Empty and greater-than-256-character run identifiers fail before either persistence port is called. (Test: `rejects empty or overlong run identifiers before accessing either port`)
- **missing bundle short circuit**: A missing numeric bundle produces EvidenceBundleNotFoundError and never queries the external schema. (Test: `reports a missing numeric bundle without querying raw observations`)
- **resolved run without rows**: A bundle that resolves to a run ID with no raw rows produces RawObservationsNotFoundError for that resolved ID. (Test: `reports missing observations for a resolved bundle run id`)
- **direct run without rows**: A direct run ID with no raw rows produces RawObservationsNotFoundError for that direct ID. (Test: `reports missing observations for a direct run id`)
- **successful lineage result**: Success returns the concrete run ID and preserves the adapter's item order and values. (Test: `returns the resolved run id with observations without mutating them`)

