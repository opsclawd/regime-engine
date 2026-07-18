# Task Context: Task 6

Title: Add exact-scope latest reads and lifecycle derivation
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

- Modify: `src/application/ports/evidenceBundleRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresEvidenceBundleRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts`

- [ ] **Step 1: Write latest-read invariants first**

Add exact named cases `derives lifecycle at inclusive freshness and expiry boundaries`, `returns latest evidence independently for each source`, `never mixes exact evidence scopes`, and `fails visibly when stored payload JSON is corrupt`. Cover all four scope kinds, source-filtered and unfiltered reads, ties on as-of/receipt/id, expired rows remaining observable, and no row returning an empty list rather than falling back to another scope.

Run: `pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts`

Expected: FAIL because `getLatest` is absent.

- [ ] **Step 2: Add the method to the port and adapter together**

Extend the same exported interface and implementation with:

```ts
getLatest(input: {
  pair: "SOL/USDC";
  scope: EvidenceScope;
  source: EvidenceSourceFilter | null;
  nowUnixMs: number;
}): Promise<EvidenceBundleRecord[]>;
```

Define `EvidenceBundleRecord` as validated `bundle`, row ID, payload hash, received time, and `lifecycle: "FRESH" | "STALE" | "EXPIRED"`. Use `row_number() over (partition by source_publisher, source_id order by as_of_unix_ms desc, received_at_unix_ms desc, id desc)` for unfiltered reads and the same ordering with `limit 1` for a filter. Match pair and derived exact `scopeKey` in every query.

Map rows by calling `parseEvidenceBundleV1(row.payloadJson)` before returning. Derive lifecycle with the inclusive transition table from the invariant; do not update the row and do not decide selection eligibility.

- [ ] **Step 3: Run focused latest verification**

Run: `pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts`

Expected: PASS when Postgres is configured and SKIP otherwise.

Run: `pnpm exec eslint src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit the method with all implementation changes**

```bash
git add src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts
git commit -m "m58: query latest evidence by exact scope"
```

## Repository Targets

### Expected Files
- src/application/ports/evidenceBundleRepositoryPort.ts
- src/adapters/postgres/postgresEvidenceBundleRepository.ts
- src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts

## Validation Commands

```bash
pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts
pnpm exec eslint src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **inclusive lifecycle transitions**: Now through freshUntil is FRESH, then through expiresAt is STALE, and only later is EXPIRED. (Test: `derives lifecycle at inclusive freshness and expiry boundaries`)
- **latest partitions by source**: Unfiltered reads return one deterministically latest record per publisher/source ID; a source filter returns at most one. (Test: `returns latest evidence independently for each source`)
- **latest uses exact scope**: Pair, Whirlpool, wallet, and position records never satisfy one another's exact-scope query. (Test: `never mixes exact evidence scopes`)
- **stored payloads revalidate**: Malformed persisted JSONB fails during row mapping and never escapes as typed evidence. (Test: `fails visibly when stored payload JSON is corrupt`)

