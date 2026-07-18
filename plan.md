<!-- plan-review-required -->

# EvidenceBundle v1 Contract and Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a strict, portable `evidence-bundle.v1` contract and persist validated bundles in an append-only Postgres repository with deterministic replay, exact-scope latest reads, bounded cursor history, and query-time lifecycle metadata.

**Architecture:** A checked-in JSON Schema 2020-12 document is the normative publisher contract. Generated TypeScript declarations and an Ajv structural validator consume that schema, while a deterministic semantic pass enforces graph, timestamp, feature-status, and coverage invariants that JSON Schema cannot express cleanly. The application owns an `EvidenceBundleRepositoryPort`; a Drizzle/Postgres adapter stores the complete canonical payload plus indexed identity/lifecycle columns in one immutable row and derives `FRESH | STALE | EXPIRED` at read time.

**Tech Stack:** TypeScript 5.8, Node 22, JSON Schema 2020-12, Ajv 8 with `ajv-formats`, `json-schema-to-typescript`, Drizzle ORM/drizzle-kit, Postgres, Vitest, pnpm.

**Source documents:** `design.md`, `issue.md`, and the empty `issue-comments.md`.

---

**Goals**

- Make `contracts/evidence-bundle/v1/evidence-bundle.schema.json` the single machine-readable authority for the wire shape.
- Accept deterministic-only bundles with five empty contextual collections and `researchBrief: null`, while requiring coverage and warning metadata that makes those absences explicit.
- Preserve deterministic features, contextual claims, and research summaries as separate typed structures with no policy/recommendation fields.
- Publish generated types, valid and invalid fixtures, canonical/hash vectors, the schema SHA-256, artifact documentation, and packaged build assets.
- Store complete accepted bundles atomically and append-only, separately from `clmm_insights`.
- Implement the source/run replay state machine and exact-scope latest/history reads, including stable ordering, bounded keyset pagination, payload revalidation, and lifecycle derivation.

**Non-goals**

- HTTP routes, handlers, authentication, request-body limits, OpenAPI, or public response redaction (#59).
- Evidence selection, ranking, scoring, or source-family weighting (#60).
- `PolicyInsight` synthesis, recommendations, allocation, CLMM policy, or guard evaluation (#61).
- Removing or migrating the legacy `clmm_insights` path.
- Intelligence collectors, prompts, publisher clients, Solana RPC validation, or changes to `clmm-v2`.
- SQLite persistence or a local fallback for evidence bundles.
- Supporting pairs other than `SOL/USDC` or networks other than `solana-mainnet` in v1.

**Affected files**

| Path from repository root                                                                                                                                                                                                                                                                                                                                                                                                                      | Responsibility                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `package.json`                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pin contract tooling, add generation/check scripts, and include evidence PG tests in `test:pg`.     |
| `pnpm-lock.yaml`                                                                                                                                                                                                                                                                                                                                                                                                                               | Lock Ajv, formats, and schema-to-TypeScript generator versions.                                     |
| `scripts/generateEvidenceContract.ts`                                                                                                                                                                                                                                                                                                                                                                                                          | Generate declarations/schema digest and check checked-in artifacts without rewriting in check mode. |
| `scripts/copyBuildAssets.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                  | Copy the public contract tree into `dist/contracts/evidence-bundle/v1`.                             |
| `contracts/evidence-bundle/v1/evidence-bundle.schema.json`                                                                                                                                                                                                                                                                                                                                                                                     | Normative strict JSON Schema 2020-12 contract.                                                      |
| `contracts/evidence-bundle/v1/schema.sha256`                                                                                                                                                                                                                                                                                                                                                                                                   | Lowercase SHA-256 of the exact schema bytes and relative schema path.                               |
| `contracts/evidence-bundle/v1/hash-vectors.json`                                                                                                                                                                                                                                                                                                                                                                                               | Cross-repository canonical JSON and SHA-256 vectors.                                                |
| `contracts/evidence-bundle/v1/fixtures/valid/deterministic-only.json`                                                                                                                                                                                                                                                                                                                                                                          | Minimal valid deterministic-only bundle.                                                            |
| `contracts/evidence-bundle/v1/fixtures/valid/contextual.json`                                                                                                                                                                                                                                                                                                                                                                                  | Valid contextual bundle with a resolved research brief.                                             |
| `contracts/evidence-bundle/v1/fixtures/invalid/wrong-schema-version.json`, `unknown-field.json`, `unsupported-unit.json`, `noncanonical-timestamp.json`, `reversed-lifecycle.json`, `out-of-range-number.json`, `status-value-mismatch.json`, `duplicate-lineage.json`, `unresolved-lineage.json`, `malformed-contextual-family.json`, `unresolved-brief-evidence.json`, `null-brief-available-coverage.json`, `empty-context-no-warning.json` | One-purpose invalid payloads beneath `contracts/evidence-bundle/v1/fixtures/invalid/`.              |
| `src/contract/evidence/v1/types.generated.ts`                                                                                                                                                                                                                                                                                                                                                                                                  | Generated wire declarations tied to schema path and digest.                                         |
| `src/contract/evidence/v1/validate.ts`                                                                                                                                                                                                                                                                                                                                                                                                         | Unified Ajv structural and deterministic semantic validator.                                        |
| `src/contract/evidence/v1/__tests__/generation.test.ts`                                                                                                                                                                                                                                                                                                                                                                                        | Schema/type/digest reproducibility tests.                                                           |
| `src/contract/evidence/v1/__tests__/validation.test.ts`                                                                                                                                                                                                                                                                                                                                                                                        | Valid fixture, invalid fixture, boundary, conditional, and graph-invariant tests.                   |
| `src/contract/evidence/v1/__tests__/canonicalHash.test.ts`                                                                                                                                                                                                                                                                                                                                                                                     | Published hash-vector reproduction and array/object ordering tests.                                 |
| `src/application/ports/evidenceBundleRepositoryPort.ts`                                                                                                                                                                                                                                                                                                                                                                                        | Application-facing append/latest/history types and repository interface.                            |
| `src/adapters/postgres/postgresEvidenceBundleRepository.ts`                                                                                                                                                                                                                                                                                                                                                                                    | Postgres implementation of every repository method.                                                 |
| `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts`                                                                                                                                                                                                                                                                                                                                                              | PG-gated append/replay/conflict tests.                                                              |
| `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts`                                                                                                                                                                                                                                                                                                                                                              | PG-gated exact-scope latest/lifecycle/rehydration tests.                                            |
| `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.history.test.ts`                                                                                                                                                                                                                                                                                                                                                             | PG-gated cursor/history/isolation tests.                                                            |
| `src/ledger/pg/schema/evidenceBundles.ts`                                                                                                                                                                                                                                                                                                                                                                                                      | Drizzle table, constraints, indexes, row and insert types.                                          |
| `src/ledger/pg/schema/index.ts`                                                                                                                                                                                                                                                                                                                                                                                                                | Re-export evidence schema symbols.                                                                  |
| `src/ledger/pg/schema/__tests__/evidenceBundles.shape.test.ts`                                                                                                                                                                                                                                                                                                                                                                                 | Table and index shape smoke test.                                                                   |
| `src/ledger/pg/__tests__/evidenceBundlesMigration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                     | PG-gated migration separation/constraint test.                                                      |
| `drizzle/0004_create_evidence_bundles.sql`                                                                                                                                                                                                                                                                                                                                                                                                     | Generated additive migration.                                                                       |
| `drizzle/meta/0004_snapshot.json`                                                                                                                                                                                                                                                                                                                                                                                                              | Generated Drizzle schema snapshot.                                                                  |
| `drizzle/meta/_journal.json`                                                                                                                                                                                                                                                                                                                                                                                                                   | Generated migration journal entry.                                                                  |
| `docs/contracts/evidence-bundle.v1.md`                                                                                                                                                                                                                                                                                                                                                                                                         | Ownership, artifact, canonicalization, hash, lifecycle, idempotency, and query documentation.       |

**Behavioral invariants**

The named cases below are written first in the task that owns the behavior and are also recorded in `task-manifest.json`.

- `accepts deterministic-only evidence with explicit unavailable coverage`: empty contextual arrays plus `researchBrief: null` are valid only with unavailable/not-applicable family coverage, degraded/partial quality, and the required absence warnings.
- `rejects available features whose value does not match featureKind`: available number/boolean/category features require their matching value primitive and unit relationship.
- `rejects unavailable features encoded as numeric zero`: unavailable/invalid features require `value: null`, `unit: null`, zero confidence, and at least one warning.
- `rejects noncanonical or reversed publisher timestamps`: timestamps must be exact millisecond UTC strings and obey `asOf <= createdAt < freshUntil <= expiresAt`; available feature times obey `observedAt <= asOf <= freshUntil`.
- `rejects duplicate or unresolved evidence lineage`: IDs are unique in their namespace and every source/feature/brief reference resolves according to the contract.
- `rejects coverage that fabricates absent evidence`: empty contextual families and a null brief cannot report successful coverage; present evidence cannot report unavailable coverage.
- `creates one immutable row for a new source run`: a previously unseen idempotency tuple inserts once and returns `created` with the original receipt metadata.
- `returns already_ingested for an identical source run replay`: a matching idempotency tuple and payload hash returns the stored row without replacing payload bytes or `receivedAt`.
- `throws EVIDENCE_RUN_CONFLICT for a changed source run replay`: a matching tuple with a different payload hash fails deterministically and preserves the first truth row.
- `fails when a losing append cannot load the winning row`: conflict-without-winner is an invariant failure, never an idempotent success.
- `derives lifecycle at inclusive freshness and expiry boundaries`: `now <= freshUntil` is `FRESH`, `freshUntil < now <= expiresAt` is `STALE`, and `now > expiresAt` is `EXPIRED` without updating storage.
- `returns latest evidence independently for each source`: unfiltered current reads partition by publisher/source ID and order each partition by `asOf DESC, receivedAt DESC, id DESC`; filtered reads return at most one row.
- `never mixes exact evidence scopes`: pair, Whirlpool, wallet, and position scope keys are distinct and queries match both pair and the full validated scope.
- `paginates history without duplicates across intervening inserts`: history uses `(receivedAtUnixMs, id)` descending as an exclusive cursor, so a new head insert cannot duplicate or skip rows on the next page.
- `rejects history limits outside one through one hundred`: default is 30; explicit limits below 1 or above 100 fail before SQL executes.
- `fails visibly when stored payload JSON is corrupt`: every row is revalidated during mapping; malformed JSONB never escapes as an `EvidenceBundleV1`.

## Task 1: Establish the normative schema and reproducible type-generation toolchain

**Files:**

- Create: `contracts/evidence-bundle/v1/evidence-bundle.schema.json`
- Create: `contracts/evidence-bundle/v1/schema.sha256`
- Create: `scripts/generateEvidenceContract.ts`
- Create: `src/contract/evidence/v1/types.generated.ts`
- Create: `src/contract/evidence/v1/__tests__/generation.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write the failing reproducibility test**

Create `src/contract/evidence/v1/__tests__/generation.test.ts`. It must spawn `pnpm run contract:evidence:check`, assert exit code zero after generation exists, independently hash the schema bytes, parse `schema.sha256` as `<hex>  <relative-path>`, and assert the generated declaration header contains both the schema path and digest. Name the cases exactly:

- `keeps generated types and schema digest reproducible` invokes check mode from a child process and asserts a zero exit code.
- `records the exact schema byte hash in every generated authority marker` reads the schema, digest file, and generated declaration header, computes SHA-256 with `node:crypto`, and asserts all three lowercase digests are identical.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/generation.test.ts`

Expected: FAIL because the schema, generator, and package scripts do not exist.

- [ ] **Step 2: Add pinned tooling and deterministic scripts**

Add `ajv` and `ajv-formats` to `dependencies`, and `json-schema-to-typescript` to `devDependencies`. Add these scripts:

```json
{
  "contract:evidence:generate": "tsx scripts/generateEvidenceContract.ts --write",
  "contract:evidence:check": "tsx scripts/generateEvidenceContract.ts --check"
}
```

Run `pnpm install` so `pnpm-lock.yaml` records the chosen exact resolution and the focused tests can load the new packages. Do not add a general schema code-generation framework.

- [ ] **Step 3: Author the complete strict JSON Schema**

Create a draft 2020-12 schema with stable `$id`, root title `EvidenceBundleV1`, `additionalProperties: false` on every object, every root property required, explicit nullable unions, and these root properties:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://contracts.opsclawd.dev/regime-engine/evidence-bundle/v1/evidence-bundle.schema.json",
  "title": "EvidenceBundleV1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "pair",
    "scope",
    "source",
    "runId",
    "correlationId",
    "createdAt",
    "asOf",
    "freshUntil",
    "expiresAt",
    "deterministicFeatures",
    "contextualEvidence",
    "researchBrief",
    "sourceReferences",
    "assessment",
    "provenance"
  ]
}
```

Implement `$defs` for the four exact scope variants; source identity; three discriminated feature kinds crossed with `available | unavailable | invalid`; five contextual claim families; research brief/model; source reference; coverage, warning, assessment, and provenance. Encode all enumerations and bounds from `design.md`, including 1–128 identifiers, 1–256 run/correlation IDs, canonical timestamp regex `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`, lowercase 64-hex hashes, confidence integers 0–10000, finite JSON numeric bounds, array min/max/uniqueness, exact five contextual properties, and numeric units `usd | sol | usdc | percent | basis_points | ratio | seconds | milliseconds | count | price_usdc_per_sol` plus `boolean | category` for their matching feature kinds. Fix family-specific claim kinds to `support_zone | resistance_zone | breakout_level`, `spot_flow | stablecoin_flow | exchange_flow`, `funding | open_interest | liquidation | options_skew`, `scheduled_event | protocol_incident | network_incident`, and `ecosystem_news | regulatory_update`, respectively. Fix source types to `api | database | chain | document | internal_bundle`. Use `if`/`then` branches so feature kind/status determines `value`, `unit`, timestamps, confidence, and warning minima. Keep cross-record reference resolution and time ordering out of the schema for Task 2.

- [ ] **Step 4: Implement write/check generation modes**

`scripts/generateEvidenceContract.ts` must:

1. read the schema as bytes and parse it;
2. compute lowercase SHA-256 of those exact bytes;
3. call `compileFromFile` with deterministic `json-schema-to-typescript` options (`bannerComment: ""`, `style.singleQuote: false`, no timestamp-bearing output);
4. prepend `// Generated from contracts/evidence-bundle/v1/evidence-bundle.schema.json (sha256: <digest>). Do not edit.`;
5. render `schema.sha256` as `<digest>  contracts/evidence-bundle/v1/evidence-bundle.schema.json\n`;
6. in `--write`, update only files whose bytes differ;
7. in `--check`, compare expected bytes and exit nonzero with the exact stale paths, without writing.

Reject missing or multiple modes. Resolve paths relative to the repository root derived from `import.meta.url`; do not depend on the caller's current directory.

- [ ] **Step 5: Generate declarations and digest, then prove stability**

Run: `pnpm run contract:evidence:generate`

Expected: creates `types.generated.ts` and `schema.sha256` with no timestamps.

Run: `pnpm run contract:evidence:check`

Expected: PASS without changing either generated file.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/generation.test.ts`

Expected: PASS.

Run: `pnpm exec prettier --check package.json scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/evidence-bundle.schema.json src/contract/evidence/v1/types.generated.ts src/contract/evidence/v1/__tests__/generation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the schema authority as one unit**

```bash
git add package.json pnpm-lock.yaml scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/evidence-bundle.schema.json contracts/evidence-bundle/v1/schema.sha256 src/contract/evidence/v1/types.generated.ts src/contract/evidence/v1/__tests__/generation.test.ts
git commit -m "m58: publish EvidenceBundle v1 schema"
```

## Task 2: Add fixtures and unified structural-semantic validation

**Files:**

- Create: `contracts/evidence-bundle/v1/fixtures/valid/deterministic-only.json`
- Create: `contracts/evidence-bundle/v1/fixtures/valid/contextual.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/wrong-schema-version.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/unknown-field.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/unsupported-unit.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/noncanonical-timestamp.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/reversed-lifecycle.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/out-of-range-number.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/status-value-mismatch.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/duplicate-lineage.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/unresolved-lineage.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/malformed-contextual-family.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/unresolved-brief-evidence.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/null-brief-available-coverage.json`
- Create: `contracts/evidence-bundle/v1/fixtures/invalid/empty-context-no-warning.json`
- Create: `src/contract/evidence/v1/validate.ts`
- Create: `src/contract/evidence/v1/__tests__/validation.test.ts`

- [ ] **Step 1: Write the named contract tests first**

Load JSON fixtures with `node:fs`, then add exact test names for the six contract invariants listed at the top of this plan. Add table-driven cases for every invalid fixture, asserting a stable result shape:

```ts
type EvidenceValidationIssue = {
  path: string;
  code: "STRUCTURAL" | "SEMANTIC" | "UNSUPPORTED_SCHEMA_VERSION";
  message: string;
};

type EvidenceValidationResult =
  | { ok: true; value: EvidenceBundleV1 }
  | { ok: false; issues: EvidenceValidationIssue[] };
```

Also test canonical timestamp equality boundaries, invalid calendar dates despite regex match, confidence 0/10000, scalar and array min/max boundaries, every scope variant, all unit enums, all feature kind/status combinations, all contextual family coverage relationships, unknown fields at root and nested levels, duplicate feature/evidence/reference IDs, feature-to-feature and feature-to-reference lineage, and research-brief references. Programmatically pass `NaN`, infinities, and `-0` to the validator because they cannot be represented in JSON fixtures.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/validation.test.ts`

Expected: FAIL because `validate.ts` and fixtures do not exist.

- [ ] **Step 2: Create the two valid publisher fixtures**

The deterministic fixture must use pair scope, one available numeric feature, one source reference, five empty contextual arrays, `researchBrief: null`, contextual and brief coverage `unavailable`, quality `partial` or `degraded`, and both `CONTEXTUAL_EVIDENCE_UNAVAILABLE` and `RESEARCH_BRIEF_UNAVAILABLE` warnings. The contextual fixture must use position scope, include at least one claim in each contextual family, and a non-null brief whose `sourceEvidenceIds` all resolve. Emit feature, claim, reference, warning, and upstream-run arrays in their documented stable order.

- [ ] **Step 3: Create one-purpose invalid fixtures**

Derive every invalid file from `deterministic-only.json` and introduce only the defect named by its filename. `malformed-contextual-family.json` uses an invalid family-specific `kind`; `duplicate-lineage.json` repeats an ID; `unresolved-lineage.json` points at a missing reference/feature; `null-brief-available-coverage.json` reports brief coverage `available` with a null brief; `empty-context-no-warning.json` removes the contextual absence warning. Keep each file valid JSON so downstream consumers can use the same corpus.

- [ ] **Step 4: Implement one acceptance API around Ajv and semantic checks**

Use `Ajv2020` with `allErrors: true`, `strict: true`, and `ajv-formats`. Detect a non-literal `schemaVersion` first and return `UNSUPPORTED_SCHEMA_VERSION`; then run the compiled schema. Map Ajv errors to JSON-pointer-like paths and stable messages. Only after structural success, run pure semantic checks for:

- real calendar validity and exact round-trip canonical timestamps;
- root and available-feature time ordering;
- unique IDs across features, claims, and source references;
- allowed feature input lineage resolution without self-reference or cycles;
- contextual source-reference and brief evidence-reference resolution;
- empty/present family coverage agreement;
- required warning coverage for every unavailable family and null brief;
- quality not `complete` when required coverage is unavailable.

Sort all issues by `path`, then `code`, then `message`; never mutate or reorder the input. Export `validateEvidenceBundleV1(input: unknown): EvidenceValidationResult` and `parseEvidenceBundleV1(input: unknown): EvidenceBundleV1`, where the parser throws an `EvidenceBundleValidationError` containing the same sorted issues.

- [ ] **Step 5: Run focused contract verification**

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/validation.test.ts`

Expected: PASS with every invalid fixture rejected for its intended path/code and both valid fixtures accepted.

Run: `pnpm exec eslint src/contract/evidence/v1/validate.ts src/contract/evidence/v1/__tests__/validation.test.ts`

Expected: PASS with zero warnings.

- [ ] **Step 6: Commit fixtures and acceptance authority**

```bash
git add contracts/evidence-bundle/v1/fixtures src/contract/evidence/v1/validate.ts src/contract/evidence/v1/__tests__/validation.test.ts
git commit -m "m58: validate EvidenceBundle v1 semantics"
```

## Task 3: Publish cross-repository canonical JSON and hash vectors

**Files:**

- Create: `contracts/evidence-bundle/v1/hash-vectors.json`
- Create: `src/contract/evidence/v1/__tests__/canonicalHash.test.ts`
- Modify: `scripts/generateEvidenceContract.ts`

- [ ] **Step 1: Write failing published-vector tests**

Use `canonicalJson` and `sha256Hex` from `src/contract/v1`. Define the vector file shape explicitly:

```ts
interface EvidenceHashVector {
  name: string;
  payload: unknown;
  canonical: string;
  utf8ByteLength: number;
  sha256: string;
  schemaSha256: string;
}
```

Name tests `reproduces every published EvidenceBundle hash vector`, `ignores object insertion order but preserves array order`, `normalizes negative zero and preserves ECMAScript exponent formatting`, and `detects a deliberately mismatched published hash`. Validate each payload first, except focused primitive canonicalizer vectors. Assert the schema digest on every vector.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/canonicalHash.test.ts`

Expected: FAIL because `hash-vectors.json` is absent.

- [ ] **Step 2: Generate deterministic vectors**

Extend the generator to derive vectors from the two valid fixtures plus focused non-ASCII, negative-zero, exponent, empty-context, null-brief, and array-reorder inputs. For every vector, compute canonical text, UTF-8 byte length, SHA-256, and current schema SHA-256. `--write` writes stable pretty JSON with a final newline; `--check` compares bytes and reports the vector path as stale. Do not accept a publisher-supplied `payloadHash` field.

- [ ] **Step 3: Prove vectors and regeneration are stable**

Run: `pnpm run contract:evidence:generate`

Run: `pnpm run contract:evidence:check`

Expected: PASS without rewriting published vectors.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/canonicalHash.test.ts src/contract/evidence/v1/__tests__/generation.test.ts`

Expected: PASS.

Run: `pnpm exec prettier --check scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/hash-vectors.json src/contract/evidence/v1/__tests__/canonicalHash.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit portable hash vectors**

```bash
git add scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/hash-vectors.json src/contract/evidence/v1/__tests__/canonicalHash.test.ts
git commit -m "m58: publish EvidenceBundle hash vectors"
```

## Task 4: Add the append-only evidence table and migration

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

## Task 5: Implement append, replay, and conflict through the repository port

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

## Task 6: Add exact-scope latest reads and lifecycle derivation

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

## Task 7: Add bounded cursor history without scope mixing

**Files:**

- Modify: `src/application/ports/evidenceBundleRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresEvidenceBundleRepository.ts`
- Create: `src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.history.test.ts`

- [ ] **Step 1: Write cursor and limit invariants first**

Add exact named cases `paginates history without duplicates across intervening inserts`, `rejects history limits outside one through one hundred`, `never mixes exact evidence scopes in history`, and `orders evidence history by receipt time and id descending`. Cover default 30, explicit 1 and 100, source filtering, `(receivedAt DESC, id DESC)` tie-breaking, empty history, cursor exclusivity, new rows inserted between pages, lifecycle derivation, and corrupt stored payload rejection.

Run: `pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.history.test.ts`

Expected: FAIL because `getHistory` is absent.

- [ ] **Step 2: Add history to the port and adapter together**

Extend both with:

```ts
export interface EvidenceHistoryCursor {
  receivedAtUnixMs: number;
  id: number;
}

getHistory(input: {
  pair: "SOL/USDC";
  scope: EvidenceScope;
  source: EvidenceSourceFilter | null;
  limit?: number;
  cursor: EvidenceHistoryCursor | null;
  nowUnixMs: number;
}): Promise<{
  records: EvidenceBundleRecord[];
  nextCursor: EvidenceHistoryCursor | null;
}>;
```

Validate limit before SQL. Query `limit + 1` rows to determine continuation, ordered by receipt and ID descending. For a cursor, add the exclusive predicate `received_at_unix_ms < cursor.receivedAtUnixMs OR (received_at_unix_ms = cursor.receivedAtUnixMs AND id < cursor.id)`. Return a cursor from the last emitted record only when an extra row exists. Reuse exact scope-key mapping, payload revalidation, and lifecycle derivation.

- [ ] **Step 3: Run focused history and regression verification**

Run: `pnpm vitest run src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.history.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.latest.test.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.append.test.ts`

Expected: PASS when Postgres is configured and SKIP otherwise.

Run: `pnpm exec eslint src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.history.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit the method with its adapter implementation**

```bash
git add src/application/ports/evidenceBundleRepositoryPort.ts src/adapters/postgres/postgresEvidenceBundleRepository.ts src/adapters/postgres/__tests__/postgresEvidenceBundleRepository.history.test.ts
git commit -m "m58: paginate evidence bundle history"
```

## Task 8: Package and document the public compatibility surface

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
