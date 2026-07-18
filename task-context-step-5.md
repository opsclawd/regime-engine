# Task Context: Task 5

Title: Implement append, replay, and conflict through the repository port
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-58
Repository: opsclawd/regime-engine
Branch: ai/issue-58
Start Commit: 7bd5b19db3afbf66e95e06ac273453030f5381fe

## Task Requirements

**Files:**

- Create: `src/application/ports/evidenceBundleRepositoryPort.ts`
- Create: `src/adapters/postgres/postgresEvidenceBundleRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts`

- [ ] **Step 1: Write the append state-machine tests first**

Write exact named cases `creates one immutable row for a new source run`, `returns already_ingested for an identical source run replay`, `throws EVIDENCE_RUN_CONFLICT for a changed source run replay`, and `fails when a losing append cannot load the winning row`. Add sequential and concurrent identical/different replay cases, different run/source acceptance, full JSON/canonical/scalar persistence, and original `receivedAt` retention.

Run: `pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts`

Expected: FAIL because the port and adapter do not exist.

- [ ] **Step 2: Define the append contract and exact scope-key derivation**

In the application port, export `EvidenceScopeQuery`, `EvidenceSourceFilter`, receipt/result types, `EvidenceRunConflictError` with `errorCode = "EVIDENCE_RUN_CONFLICT"`, and:

```ts
export interface EvidenceBundleRepositoryPort {
  append(input: {
    bundle: EvidenceBundleV1;
    payloadCanonical: string;
    payloadHash: string;
    receivedAtUnixMs: number;
  }): Promise<
    | { status: "created"; receipt: EvidenceBundleReceipt }
    | { status: "already_ingested"; receipt: EvidenceBundleReceipt }
  >;
}
```

Export a pure `evidenceScopeKey(scope)` helper using unambiguous tagged length-prefixed components, for example `pair`, `whirlpool:<address>`, `wallet:<address>`, and `position:<wallet-length>:<wallet><pool-length>:<pool><position-length>:<position>`. Scope values remain case-sensitive and are never inferred from features.

- [ ] **Step 3: Implement append in the Postgres adapter in the same task**

Create `createPostgresEvidenceBundleRepository(db): EvidenceBundleRepositoryPort`. Derive every scalar column from the already-validated bundle. Insert with conflict-do-nothing on `(schemaVersion, source.publisher, source.sourceId, runId)`, returning the row. When no row is returned, read the winning identity: equal hash (and defensively equal canonical text) returns `already_ingested`; different bytes throw `EvidenceRunConflictError`; missing winner throws the append-only invariant error. Return row ID, stored hash, and stored original receipt time. Expose no update or delete operation.

- [ ] **Step 4: Run focused append verification**

Run: `pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts`

Expected: PASS when Postgres is configured and SKIP otherwise.

Run: `pnpm exec eslint src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts`

Expected: PASS with zero warnings.

- [ ] **Step 5: Commit the append port and its only adapter atomically**

```bash
git add src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts
git commit -m "m58: append immutable evidence bundles"
```

## Repository Targets

### Expected Files
- src/application/ports/evidenceBundleRepositoryPort.ts
- src/adapters/postgres/postgresEvidenceBundleRepository.ts
- src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts

## Validation Commands

```bash
pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts
pnpm exec eslint src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **new source run creates once**: An unseen idempotency tuple creates one immutable row and returns its receipt. (Test: `creates one immutable row for a new source run`)
- **identical replay is idempotent**: A matching identity and canonical payload returns already_ingested without replacing payload or receipt time. (Test: `returns already_ingested for an identical source run replay`)
- **changed replay conflicts**: A matching identity with a different payload throws EVIDENCE_RUN_CONFLICT and preserves the first row. (Test: `throws EVIDENCE_RUN_CONFLICT for a changed source run replay`)
- **missing conflict winner is an invariant failure**: A losing insert that cannot read the winning row fails visibly rather than claiming idempotency. (Test: `fails when a losing append cannot load the winning row`)

