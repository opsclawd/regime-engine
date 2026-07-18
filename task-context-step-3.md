# Task Context: Task 3

Title: Implement validated evidence ingestion use case
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-59
Repository: opsclawd/regime-engine
Branch: ai/issue-59
Start Commit: 90e95da66c50bf9c462dfa0d552e3b13bce9a965

## Task Requirements

**Files:**

- Create: `src/application/use-cases/ingestEvidenceBundleUseCase.ts`
- Create: `src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts`

- [ ] **Step 1: Write failing use-case tests first**

Use an inline fake `EvidenceBundleRepositoryPort` and fixed `ClockPort`. Name cases exactly `validates and hashes before append`, `invalid evidence never reaches append`, `preserves the original receipt on exact replay`, and `propagates evidence run conflicts`. Load the published deterministic-only fixture and hash vector; assert the append input contains the parsed bundle, published canonical bytes/hash, and the one clock value.

Run: `pnpm vitest run src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts`

Expected: FAIL because the use case does not exist.

- [ ] **Step 2: Add the exported use-case contract and implementation**

Implement this exact public shape:

```ts
export type IngestEvidenceBundleUseCase = (input: unknown) => Promise<{
  status: "created" | "already_ingested";
  runId: string;
  evidenceHash: string;
  receipt: EvidenceBundleReceipt;
}>;

export const createIngestEvidenceBundleUseCase = (deps: {
  repository: EvidenceBundleRepositoryPort;
  clock: ClockPort;
}): IngestEvidenceBundleUseCase => async (input) => {
  const bundle = parseEvidenceBundleV1(input);
  const payloadCanonical = toCanonicalJson(bundle);
  const payloadHash = sha256Hex(payloadCanonical);
  const result = await deps.repository.append({
    bundle,
    payloadCanonical,
    payloadHash,
    receivedAtUnixMs: deps.clock.nowUnixMs()
  });
  return { status: result.status, runId: bundle.runId, evidenceHash: result.receipt.evidenceHash, receipt: result.receipt };
};
```

Do not accept caller-supplied hash or receipt time and do not catch validation/conflict/store errors here.

- [ ] **Step 3: Verify and commit**

Run: `pnpm vitest run src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts`

Expected: PASS, including exact vector equality and zero repository calls for invalid input.

Commit: `git add src/application/use-cases/ingestEvidenceBundleUseCase.ts src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts && git commit -m "m59: add evidence ingest use case"`

## Repository Targets

### Expected Files
- src/application/use-cases/ingestEvidenceBundleUseCase.ts
- src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts

## Validation Commands

```bash
pnpm vitest run src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **validates and hashes before append**: Invalid unknown input never reaches persistence; valid evidence is parsed, canonicalized, SHA-256 hashed, timestamped once, and appended with those exact values. (Test: `validates and hashes before append`)
- **preserves repository replay outcomes**: Created and already_ingested receipts pass through unchanged, and EvidenceRunConflictError propagates without rewriting. (Test: `preserves the original receipt on exact replay`)

