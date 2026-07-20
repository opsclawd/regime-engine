# Task Context: Task 5

Title: Ship the contract assets and downstream handoff documentation
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-63
Repository: opsclawd/regime-engine
Branch: ai/issue-63
Start Commit: 543eadf9bf435b01023d1cdabc973036a876c595

## Task Requirements

**Files:**

- Modify: `scripts/copyBuildAssets.mjs`
- Create: `docs/contracts/policy-insight.v1.md`

- [ ] **Step 1: Add a failing build-asset assertion to the existing copy script workflow.** Extend `copyBuildAssets.mjs` with a post-copy existence/digest check for `dist/contracts/policy-insight/v1/policy-insight.schema.json`, `schema.sha256`, and all fixture suites. The script must fail if copied schema bytes do not match the published digest.

- [ ] **Step 2: Copy the entire versioned contract directory.** Reuse `copyDirectoryRecursive` with:

  ```js
  const policyInsightSource = resolve(projectRoot, "contracts/policy-insight/v1");
  const policyInsightDest = resolve(projectRoot, "dist/contracts/policy-insight/v1");
  copyDirectoryRecursive(policyInsightSource, policyInsightDest);
  ```

- [ ] **Step 3: Write the consumer contract guide.** Document every field, enum, unit, nullability and ordering rule; semantic validation limits; immutable-content hashing boundary; freshness formula and exclusive expiry; advisory-only authority; source/dist paths; `policy-insight.v1`; exact schema SHA-256 from `schema.sha256`; generate/check commands; legacy-row exclusion and temporary 404 rollout behavior; and the handoff tuple `(merged commit SHA, schema path, schema version, schema SHA-256)`. State that the merged commit SHA is recorded by the release/PR handoff after merge and is not embedded in the commit itself.

- [ ] **Step 4: Build and verify only the assets introduced by this task.**

  Run: `pnpm run build && test -f dist/contracts/policy-insight/v1/policy-insight.schema.json && test -f dist/contracts/policy-insight/v1/schema.sha256 && cmp contracts/policy-insight/v1/policy-insight.schema.json dist/contracts/policy-insight/v1/policy-insight.schema.json && cmp contracts/policy-insight/v1/schema.sha256 dist/contracts/policy-insight/v1/schema.sha256`

  Expected: PASS; source and dist schema/digest bytes are identical.

- [ ] **Step 5: Commit packaging and documentation.**

  ```bash
  git add scripts/copyBuildAssets.mjs docs/contracts/policy-insight.v1.md
  git commit -m "m63: document and package policy insight v1"
  ```

**Tests to add or update**

- Contract generation, fixture coverage, schema/digest drift, AJV/semantic validation, canonical-hash snapshots, and freshness projection tests under `src/contract/policyInsight/v1/__tests__/`.
- Canonical action-transition and content-mapping tests under `src/engine/policy/__tests__/`, followed by updates to the four existing synthesis suites.
- Migration and PostgreSQL repository tests for nullable legacy markers, digest-aware idempotency, canonical filtering/order, and corruption rejection.
- Application use-case tests for final content assembly and one-clock current/history freshness.
- PostgreSQL HTTP e2e tests for exact success payloads, 404/400/503 behavior, limit 100, expiry boundary, and pagination stability.
- OpenAPI contract tests proving the schema/components/examples are imported from published artifacts.

**Validation commands after all implementation tasks**

The dedicated validate phase, not a standalone implementation task, runs:

```bash
pnpm run contract:policy-insight:check
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
pnpm run boundaries
```

With a disposable local PostgreSQL database configured:

```bash
pnpm run test:pg
```

The PR records which commands ran and whether PG tests were executed or skipped for lack of a disposable database.

**Risk areas**

- The existing database schema already labels legacy JSON as `policy-insight.v1`; any query missing the digest predicate can leak the wrong wire shape.
- Replacing the old uniqueness rule incorrectly can either block the first canonical write beside legacy data or permit duplicate canonical rows.
- Dynamic freshness can accidentally enter the immutable hash or use multiple clock reads, producing nondeterministic current/history responses.
- JavaScript number comparison can corrupt decimal ordering; compare canonical decimal strings with arbitrary precision/string logic.
- Closed reason/warning enums and their ordering couple schema and reducer behavior; additions require an explicit new contract version, not a silent v1 relaxation.
- OpenAPI response serialization can drop fields if a handwritten old schema remains attached even when handler tests look correct.
- Immediately after rollout, installations with no marked row legitimately return 404; operational sequencing must synthesize and verify required scopes before downstream cutover.

**Stop conditions**

- Abort rather than continue if `design.md` and the actual evidence/selection types cannot identify selected versus audit-only lineage or structured `price_usdc_per_sol` inputs without inventing policy.
- Abort if the migration cannot preserve all existing rows byte-for-byte or requires backfilling `wire_contract_sha256`.
- Abort if digest-aware uniqueness cannot be installed safely because the live schema/index differs from repository migrations; inspect and resolve schema drift before writing data.
- Abort if any port/interface edit would be committed without all adapters/implementations and callers compiling in the same task.
- Abort if schema generation is nondeterministic across two consecutive `--write`/`--check` runs.
- Abort if a marked malformed row is partially serialized or silently repaired instead of failing closed.
- Abort if current/history success responses require retaining ambiguous aliases, numeric level coercion, or handler-side advisory inference.

**Plan self-review**

- Spec coverage: every issue acceptance criterion maps to Tasks 1-5; the persistence marker, no-backfill rule, advisory authority, exact freshness, OpenAPI reuse, and downstream pinning are explicit.
- Completeness scan: every code-changing step names concrete symbols, behavior, files, and focused commands; no deferred or generic implementation instructions remain.
- Type consistency: generated `PolicyInsightContent` is the immutable stored/hash type; `PolicyInsightRead` adds only freshness; `PolicyInsightHistoryResponse` owns `queriedAt`, `limit`, items, and nullable cursor. Task 4 keeps port and adapter signature changes atomic.

## Repository Targets

### Expected Files
- scripts/copyBuildAssets.mjs
- docs/contracts/policy-insight.v1.md

## Validation Commands

```bash
pnpm run build && test -f dist/contracts/policy-insight/v1/policy-insight.schema.json && test -f dist/contracts/policy-insight/v1/schema.sha256 && cmp contracts/policy-insight/v1/policy-insight.schema.json dist/contracts/policy-insight/v1/policy-insight.schema.json && cmp contracts/policy-insight/v1/schema.sha256 dist/contracts/policy-insight/v1/schema.sha256
```

