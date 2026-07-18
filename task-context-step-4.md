# Task Context: Task 4

Title: Add the append-only evidence table and migration
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

- Create: `src/ledger/pg/schema/evidenceBundles.ts`
- Modify: `src/ledger/pg/schema/index.ts`
- Create: `src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts`
- Create: `drizzle/0004_create_evidence_bundles.sql`
- Create: `drizzle/meta/0004_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Create: `src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts`

- [ ] **Step 1: Write failing schema and migration tests**

The shape test must assert the exact 18 columns, unique idempotency tuple, current/history/correlation indexes, and the absence of update/delete helpers. The PG-gated migration cases are named `keeps evidence bundles separate from final insight rows` and `rejects invalid evidence scalar invariants at the database boundary`; they assert `regime_engine.evidence_bundles` and `regime_engine.clmm_insights` are distinct tables, existing insight rows remain untouched, and invalid timestamp ordering/hash/schema/pair rows fail database checks.

Run: `pnpm vitest run src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts`

Expected: FAIL because the table is not defined or migrated.

- [ ] **Step 2: Define the Drizzle table and exports**

Create `evidenceBundles` with `bigserial`/`serial` ID consistent with repository support, varchar identity columns, bigint `{ mode: "number" }` timestamps, `jsonb` full payload, canonical text, and 64-character hash. Export `EvidenceBundleRow` and `EvidenceBundleInsert`. Add:

```ts
uniqueIndex("uniq_evidence_bundles_source_run").on(
  t.schemaVersion,
  t.sourcePublisher,
  t.sourceId,
  t.runId
);
index("idx_evidence_bundles_current").on(
  t.pair,
  t.scopeKey,
  t.sourcePublisher,
  t.sourceId,
  t.asOfUnixMs,
  t.id
);
index("idx_evidence_bundles_history").on(t.pair, t.scopeKey, t.receivedAtUnixMs, t.id);
index("idx_evidence_bundles_correlation").on(t.correlationId, t.id);
```

Add check constraints for `evidence-bundle.v1`, `SOL/USDC`, `as_of <= created_at < fresh_until <= expires_at`, and lowercase `[0-9a-f]{64}` hash. Re-export table and row/insert types from `schema/index.ts`.

- [ ] **Step 3: Generate and inspect migration 0004**

Run: `pnpm exec drizzle-kit generate --name create_evidence_bundles`

Expected: writes `drizzle/0004_create_evidence_bundles.sql`, `drizzle/meta/0004_snapshot.json`, and journal index 4. Confirm the generated SQL creates only the additive evidence table, constraints, and four indexes; it must not alter `clmm_insights`.

- [ ] **Step 4: Run focused schema verification**

Run: `pnpm vitest run src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts`

Expected: shape test PASS; PG test PASS when `DATABASE_URL` is configured and SKIP otherwise.

Run: `pnpm exec prettier --check src/ledger/pg/schema/evidenceBundles.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts drizzle/meta/_journal.json drizzle/meta/0004_snapshot.json`

Expected: PASS.

- [ ] **Step 5: Commit schema and migration together**

```bash
git add src/ledger/pg/schema/evidenceBundles.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts drizzle/0004_create_evidence_bundles.sql drizzle/meta/0004_snapshot.json drizzle/meta/_journal.json
git commit -m "m58: add evidence bundle persistence schema"
```

## Repository Targets

### Expected Files
- src/ledger/pg/schema/evidenceBundles.ts
- src/ledger/pg/schema/index.ts
- src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts
- drizzle/0004_create_evidence_bundles.sql
- drizzle/meta/0004_snapshot.json
- drizzle/meta/_journal.json
- src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts

## Validation Commands

```bash
pnpm vitest run src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts
pnpm exec prettier --check src/ledger/pg/schema/evidenceBundles.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts drizzle/meta/_journal.json drizzle/meta/0004_snapshot.json
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **evidence and policy storage are separate**: The additive evidence_bundles migration does not mutate clmm_insights or create a foreign-key ownership coupling. (Test: `keeps evidence bundles separate from final insight rows`)
- **database defense-in-depth checks**: The table rejects unknown v1 schema/pair values, reversed lifecycle timestamps, and malformed lowercase hashes. (Test: `rejects invalid evidence scalar invariants at the database boundary`)

