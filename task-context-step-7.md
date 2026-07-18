# Task Context: Task 7

Title: Implement authenticated evidence ingest handler
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

- Create: `src/adapters/http/handlers/evidenceIngest.ts`
- Create: `src/adapters/http/handlers/__tests__/evidenceIngest.test.ts`

- [ ] **Step 1: Write failing handler tests**

Mount only the handler on a small Fastify test instance. Cover missing/wrong auth, unset server token, auth-before-invalid-body, null use case, validation issue preservation, created, exact replay with original receipt time/ID, conflict redaction, typed unavailable, and unknown internal error redaction. Capture logs and assert tokens/full bodies are absent.

Run: `pnpm vitest run src/adapters/http/handlers/__tests__/evidenceIngest.test.ts`

Expected: FAIL because the handler does not exist.

- [ ] **Step 2: Implement deterministic status/error mapping**

`createEvidenceIngestHandler(useCase: IngestEvidenceBundleUseCase | null)` must call `requireSharedSecret(request.headers, "X-Evidence-Ingest-Token", "EVIDENCE_INGEST_TOKEN")` first, then check null storage, then invoke the use case. Return `schemaVersion: "evidence-bundle.v1"`, `status`, `runId`, `evidenceHash`, `receivedAt` ISO, and `receiptId`. Map `EvidenceBundleValidationError` to `400 VALIDATION_ERROR` with its sorted issues, `EvidenceRunConflictError` to `409 EVIDENCE_RUN_CONFLICT`, `EvidenceStoreUnavailableError` or null use case to `503 EVIDENCE_STORE_UNAVAILABLE`, and unknown errors to logged/redacted `500 INTERNAL_ERROR`.

- [ ] **Step 3: Verify and commit**

Run: `pnpm vitest run src/adapters/http/handlers/__tests__/evidenceIngest.test.ts`

Expected: PASS with no use-case calls before successful auth.

Commit: `git add src/adapters/http/handlers/evidenceIngest.ts src/adapters/http/handlers/__tests__/evidenceIngest.test.ts && git commit -m "m59: add evidence ingest handler"`

## Repository Targets

### Expected Files
- src/adapters/http/handlers/evidenceIngest.ts
- src/adapters/http/handlers/__tests__/evidenceIngest.test.ts

## Validation Commands

```bash
pnpm vitest run src/adapters/http/handlers/__tests__/evidenceIngest.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **authenticates before validation and persistence**: Missing or wrong caller auth yields 401 and unset server auth yields 500 before body validation, store checks, or use-case calls. (Test: `authenticates before validation and persistence`)
- **maps ingest replay state without replacing receipts**: Created maps to 201, exact replay maps to 200 with the winning receipt, conflict maps to redacted 409, and no response exposes stored payloads or tokens. (Test: `maps ingest replay state without replacing receipts`)

