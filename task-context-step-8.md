# Task Context: Task 8

Title: Package and document the public compatibility surface
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

- Create: `docs/contracts/evidence-bundle.v1.md`
- Modify: `scripts/copyBuildAssets.mjs`
- Modify: `scripts/generateEvidenceContract.ts`
- Modify: `src/contract/evidence/v1/__tests__/generation.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing documentation and packaging checks**

Extend generation check mode to require the documentation to contain the exact current schema digest and every stable artifact path. Add focused cases to `generation.test.ts` named `publishes every EvidenceBundle artifact with the documented schema digest` and `rejects stale EvidenceBundle documentation metadata`. The first runs a build into the normal `dist` path, then asserts the schema, digest, vectors, and fixture directories exist beneath `dist/contracts/evidence-bundle/v1` with byte-identical contents. The second invokes check logic against a temporary stale documentation copy and asserts a non-writing failure that names the documentation path.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/generation.test.ts`

Expected: FAIL until documentation and build copying are implemented.

- [ ] **Step 2: Document ownership and exact portable algorithms**

Create `docs/contracts/evidence-bundle.v1.md` with:

- artifact paths and the literal generated schema SHA-256;
- commands `pnpm run contract:evidence:generate` and `pnpm run contract:evidence:check`;
- the exact UTF-16 key ordering, array preservation, compact ECMAScript JSON, negative-zero normalization, UTF-8 SHA-256 algorithm;
- all publisher-owned fields versus Regime-owned row ID, receipt time, canonical/hash metadata, lifecycle, ingest outcome, and future selection lineage;
- canonical source/run idempotency tuple and replay/conflict behavior;
- scope-key/query isolation, latest ordering, cursor format, limits, and lifecycle boundary table;
- deterministic-only semantics and the rule that missing context/brief is unavailable evidence, never zero/success;
- explicit statement that evidence cannot author policy, allocation, recommendations, or execution.

Teach the generator to replace/check a single `<!-- schema-sha256:... -->` marker so digest drift cannot be hand-maintained.

- [ ] **Step 3: Copy the entire public artifact tree during build**

Extend `copyBuildAssets.mjs` with a recursive, deterministic directory copy from `contracts/evidence-bundle/v1` to `dist/contracts/evidence-bundle/v1`, preserving file bytes and creating parent directories. Keep the existing `schema.sql` copy. Add the three evidence PG test paths to `test:pg`; do not add any HTTP tests.

- [ ] **Step 4: Run focused artifact verification**

Run: `pnpm run contract:evidence:generate`

Run: `pnpm run contract:evidence:check`

Expected: PASS without rewriting documentation or generated artifacts.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/generation.test.ts`

Expected: PASS and all packaged artifacts byte-match their source files.

Run: `pnpm exec prettier --check docs/contracts/evidence-bundle.v1.md scripts/copyBuildAssets.mjs scripts/generateEvidenceContract.ts package.json`

Expected: PASS.

- [ ] **Step 5: Commit documentation and packaged artifacts**

```bash
git add docs/contracts/evidence-bundle.v1.md scripts/copyBuildAssets.mjs scripts/generateEvidenceContract.ts src/contract/evidence/v1/__tests__/generation.test.ts package.json
git commit -m "m58: document and package EvidenceBundle artifacts"
```

**Tests to add or update**

- New schema generation/digest test: `src/contract/evidence/v1/__tests__/generation.test.ts`.
- New structural/semantic validation matrix: `src/contract/evidence/v1/__tests__/validation.test.ts`.
- New cross-language canonical/hash vector test: `src/contract/evidence/v1/__tests__/canonicalHash.test.ts`.
- New Drizzle shape and migration tests: `src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts`, `src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts`.
- Three focused PG adapter suites, split by port method: append, latest, and history. These are new files, so the existing-test-file >500 line/>10 case splitting rule is not triggered; nevertheless, keep each suite restricted to one repository method.
- Update `package.json` `test:pg` to include all three adapter suites and the migration test. Contract tests remain in the default `pnpm test` discovery.

**Validation commands after all implementation tasks**

The dedicated validate phase, not a standalone implementation task, runs:

```bash
pnpm run contract:evidence:check
pnpm run typecheck
pnpm run test
pnpm run test:pg
pnpm run lint
pnpm run boundaries
pnpm run build
pnpm run format
git diff --exit-code -- contracts/evidence-bundle/v1/schema.sha256 contracts/evidence-bundle/v1/hash-vectors.json src/contract/evidence/v1/types.generated.ts docs/contracts/evidence-bundle.v1.md
```

Expected: every command exits 0; PG suites may only be skipped in the non-PG default test command, not in `test:pg`; the final diff check proves generation/check mode left published outputs unchanged.

**Risk areas**

- The canonicalizer is repository-defined rather than RFC 8785; ECMAScript number rendering, UTF-16 object-key sorting, Unicode byte encoding, negative zero, and array order are compatibility-critical.
- JSON Schema and semantic validation can drift. One public validation API and fixture-driven generation checks must prevent structural-only acceptance.
- Generated TypeScript unions may be less precise than runtime conditionals. Runtime validation remains authoritative; persistence never accepts casts as proof.
- JSONB rows are bounded only if every string and array constraint is present. Missing a nested maximum creates a storage/validation abuse path for #59.
- Replay correctness is concurrency-sensitive. Conflict-do-nothing followed by winner lookup must retain the first payload/receipt and distinguish a missing winner from idempotency.
- Exact scope keys contain sensitive opaque identifiers. Their encoding must be collision-free and case-preserving; no route is added in this issue.
- JavaScript numeric timestamps are safe for the specified dates but database bigint mapping and cursor equality must remain exact integers.
- Generated Drizzle metadata is coupled to current migration history. If `0004` is no longer the next index when implementation starts, stop and re-plan rather than overwriting another migration.

**Stop conditions**

- Abort if `design.md` or issue acceptance criteria change the wire shape, ownership boundary, or idempotency tuple before implementation completes; regenerate the plan and artifacts from the new authority.
- Abort if migration index `0004` already exists or the current Drizzle snapshot no longer matches the inspected repository; never overwrite or renumber an unrelated migration.
- Abort if Ajv/json-schema-to-typescript cannot support draft 2020-12 and deterministic checked-in output under Node 22 with pinned versions; choose and document a compatible toolchain before proceeding.
- Abort if the schema cannot express the promised deterministic-only fixture without weakening strict unknown-field rejection or allowing fabricated zero values.
- Abort if the append method cannot atomically distinguish identical replay from different-payload conflict under concurrent Postgres transactions; do not substitute a read-before-write race.
- Abort if exact scope-key derivation is ambiguous/collision-prone or a query would implicitly combine pair, wallet, Whirlpool, and position scopes.
- Abort if implementation requires HTTP, selection, policy synthesis, SQLite fallback, legacy insight mutation, or any other non-goal; split that work into its owning issue.
- Abort on evidence of user-owned overlapping edits in any expected file; preserve those edits and request coordination rather than overwriting them.

**Assumptions**

- `evidence-bundle.v1`, `SOL/USDC`, `sol-usdc-clmm-intelligence`, and `solana-mainnet` are the v1 literal identities.
- Postgres is the sole durable evidence authority; default contract tests require no database, while `test:pg` runs migrations against the configured test database.
- Publisher arrays are ordered deliberately and remain hash-significant; validation rejects duplicates but never sorts accepted payloads.
- `receivedAtUnixMs` and query `nowUnixMs` are supplied by future use cases/clock ports; this issue defines repository behavior without adding an ingest use case or composition wiring.
- Existing canonical JSON and SHA-256 helpers remain the implementation primitive and are extended by vectors, not replaced.
- Because the design names contextual families but not their closed `kind` literals, v1 uses the explicit family-specific enums fixed in Task 1; changing those enums after publication requires an intentional compatibility review.

## Repository Targets

### Expected Files
- docs/contracts/evidence-bundle.v1.md
- scripts/copyBuildAssets.mjs
- scripts/generateEvidenceContract.ts
- src/contract/evidence/v1/__tests__/generation.test.ts
- package.json

## Validation Commands

```bash
pnpm run contract:evidence:check
pnpm vitest run src/contract/evidence/v1/__tests__/generation.test.ts
pnpm exec prettier --check docs/contracts/evidence-bundle.v1.md scripts/copyBuildAssets.mjs scripts/generateEvidenceContract.ts package.json
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **published artifacts survive production build**: The schema, digest, vectors, and all fixtures are copied byte-for-byte beneath dist/contracts/evidence-bundle/v1. (Test: `publishes every EvidenceBundle artifact with the documented schema digest`)
- **documentation digest cannot drift**: Generation check mode fails if the documentation marker or any listed public artifact is missing or stale. (Test: `rejects stale EvidenceBundle documentation metadata`)

