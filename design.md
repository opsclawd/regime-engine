# EvidenceBundle v1 Contract and Persistence

**Issue:** #58

**Status:** Proposed design

**Date:** 2026-07-17

## Problem and motivation

The intelligence engine needs a durable way to publish what it observed and
derived without becoming a second policy authority. The current external
insight path accepts a final recommendation and stores it in `clmm_insights`.
That makes Regime Engine a mailbox and allows an external research process,
including an LLM, to author fields that should be controlled by Regime Engine's
deterministic policy and safety rules.

The replacement boundary is an immutable `EvidenceBundle`: the intelligence
engine authors structured evidence; Regime Engine validates and stores the
accepted bundle; later issues select evidence and synthesize `PolicyInsight`;
`clmm-v2` retains execution authority. The contract must be usable by the first
deterministic-only publisher. Context collectors and an LLM brief are useful
enrichments, not prerequisites. Treating their absence as zero or success would
fabricate evidence, while requiring them would block the deterministic vertical
slice.

This issue also establishes the cross-repository compatibility surface. A prose
shape or TypeScript-only validator is insufficient: the intelligence repository
must be able to validate payloads and reproduce hashes without importing Regime
Engine code.

## Existing architecture and constraints

The proposed design builds on these repository patterns:

- `src/contract/v1/canonical.ts` recursively sorts object keys, preserves array
  order, normalizes `-0`, rejects non-finite numbers, and produces compact JSON;
  `src/contract/v1/hash.ts` computes lowercase SHA-256 hex.
- The v1 insight and v2 S/R contracts use strict runtime validation, explicitly
  distinguish unsupported schema versions, and reject unknown properties.
- `InsightsStore` uses Postgres, stores the canonical payload and hash, and uses
  a unique `(source, runId)` index plus `ON CONFLICT DO NOTHING` to make racing
  identical writes idempotent and different writes deterministic conflicts.
- Current reads use explicit ordering and history reads are bounded. Truth rows
  are append-only.
- New orchestration is moving behind application ports and use cases, with
  Postgres/Drizzle as an outer adapter. New evidence persistence should follow
  that boundary rather than exposing a concrete ledger store to future
  selection code.
- The repository currently has no normative standalone JSON Schema or schema
  code-generation pipeline. Adding one is justified here because this contract
  is explicitly consumed and reproduced by another repository.

## Goals

- Publish one strict, versioned, machine-readable `evidence-bundle.v1` wire
  contract and derived TypeScript types.
- Make deterministic-only bundles valid while representing absent context and
  research explicitly.
- Keep deterministic features, contextual claims, and an optional LLM research
  brief structurally and semantically separate.
- Define unambiguous source/run idempotency, pair/scope identity, timestamps,
  units, status/value relationships, lineage, ordering, and canonical hashing.
- Persist the complete accepted bundle atomically and append-only, separately
  from `clmm_insights` and future synthesized policy records.
- Support exact-scope latest reads and deterministic, bounded history reads for
  pair-, Whirlpool-, wallet-, and position-scoped evidence.
- Publish fixtures, negative cases, hash vectors, artifact paths, and the
  schema's SHA-256 so downstream work can proceed independently.

## Non-goals

- HTTP routes, authentication, request handlers, or OpenAPI changes; those
  belong to #59.
- Evidence scoring, source ranking, family weighting, or selection policy; those
  belong to #60.
- `PolicyInsight` synthesis, recommendation fields, CLMM policy, or deterministic
  guard evaluation; those belong to #61.
- Removing the legacy final-insight write path; that is sequenced separately.
- Implementing intelligence collectors, contextual packs, LLM prompts, or the
  publisher client.
- Changing `clmm-v2`, executing transactions, or handling wallet authority.
- Migrating historical `clmm_insights` into evidence records or mutating an
  accepted v1 record to a later contract version.
- Generalizing application behavior beyond the defined pair. The identity shape
  is future-compatible, but v1 accepts only `SOL/USDC`.

## Design alternatives

### 1. Zod as the source of truth with a separately maintained JSON Schema

This follows the current contract style and minimizes runtime change. However,
it creates two authoritative descriptions of a cross-repository contract.
Conditional rules such as status/value compatibility and missing-family
warnings are precisely where those descriptions would drift. Fixture tests can
reduce, but not eliminate, that risk. This is not recommended.

### 2. Normalize every feature and contextual claim into relational tables

This would make ad hoc feature queries convenient, but it expands the migration
and transaction surface, couples storage to every v1 evidence family, and makes
it harder to prove that the accepted bundle can be reconstructed byte-for-byte.
Selection consumes bundles atomically, not arbitrary joins. This is not
recommended for v1.

### 3. Normative JSON Schema with generated types and atomic bundle storage

Check in one strict JSON Schema, generate TypeScript declarations from it, and
validate at runtime with a JSON Schema 2020-12 validator. Store each accepted
bundle as a complete JSONB value plus canonical text, hash, and indexed scalar
identity columns. This adds a small validator/code-generation toolchain, but it
provides one portable authority, supports JSON Schema conditional constraints,
and matches the append-only unit used by later selection. This is the
recommended approach.

## Proposed contract

### Normative artifact and strictness

`contracts/evidence-bundle/v1/evidence-bundle.schema.json` is the normative
contract, using JSON Schema draft 2020-12 with a stable `$id`. Every object sets
`additionalProperties: false`; every property is either required or explicitly
nullable. There are no optional properties whose absence has ambiguous meaning.
The root `schemaVersion` is the exact literal `evidence-bundle.v1`.

Use pinned `ajv` with its 2020-12 entry point and `ajv-formats` for runtime
validation, and `json-schema-to-typescript` for declaration generation. The
generator is a build tool only; Ajv plus the semantic pass is the acceptance
authority. Both commands are exposed as deterministic package scripts and a
check-mode script runs in the quality gate.

`src/contract/evidence/v1/types.generated.ts` is generated from that schema and
contains a header with the schema path and schema SHA-256. Runtime validation
lives in `src/contract/evidence/v1/validate.ts` and compiles the same checked-in
schema. Semantic checks that JSON Schema cannot express clearly—cross-array ID
uniqueness, timestamp ordering, reference resolution, and coverage/warning
agreement—run immediately after structural validation and return deterministically
sorted field-path errors. Callers cannot construct persistence input without a
successfully validated `EvidenceBundleV1`.

The root shape is conceptually:

```ts
interface EvidenceBundleV1 {
  schemaVersion: "evidence-bundle.v1";
  pair: "SOL/USDC";
  scope: EvidenceScope;
  source: SourceIdentity;
  runId: string;
  correlationId: string;
  createdAt: CanonicalTimestamp;
  asOf: CanonicalTimestamp;
  freshUntil: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp;
  deterministicFeatures: DeterministicFeature[];
  contextualEvidence: ContextualEvidence;
  researchBrief: ResearchBrief | null;
  sourceReferences: SourceReference[];
  assessment: BundleAssessment;
  provenance: BundleProvenance;
}
```

Strings must already be trimmed, are non-empty and length-bounded, and use stable
label syntax where they are identifiers. Leading or trailing whitespace is
rejected rather than normalized. Arrays have explicit maximum sizes to bound
validation and row size. Unknown enum values require a new schema version.

Global bounds are part of the schema, not implementation defaults:

- label, feature, evidence, reference, source, and brief IDs are 1–128 Unicode
  code points; `runId` and `correlationId` are 1–256;
- versions, model IDs, warning codes, and calculator names are 1–128;
- addresses and `positionId` are 1–128 opaque characters;
- locators are 1–2,048, claim/finding/warning text is 1–2,048, and the research
  summary is 1–4,096;
- deterministic features number 1–128; each contextual family 0–64; source
  references 1–256; bundle warnings 0–64; feature warnings 0–16; feature input
  lineage 1–64; brief findings and uncertainties 0–32 each; brief evidence IDs
  1–256; and upstream run IDs 0–128.

Arrays are required even when their minimum is zero. Arrays described as sets
reject duplicate scalar values or duplicate identity IDs. Their order remains
part of the payload and hash; no validator or persistence adapter reorders them.

### Identity and scope

`source` contains `publisher` (literal
`sol-usdc-clmm-intelligence` for v1), `sourceId` (stable logical pipeline ID),
and `sourceVersion` (deployed producer version). `runId` identifies one immutable
publisher run. `correlationId` traces the run across collection and publication
and is not an idempotency key.

The idempotency identity is the tuple
`(schemaVersion, source.publisher, source.sourceId, runId)`. There is no separate
free-form `idempotencyKey` field because it could disagree with the source/run
identity. Documentation names this tuple the canonical idempotency key. An exact
identity replay with the same recomputed payload hash is idempotent; the same
identity with any different accepted field is a conflict. `correlationId` may be
reused across deliberate reruns with different `runId` values.

`scope` is a strict discriminated union:

- `{ kind: "pair" }`
- `{ kind: "whirlpool", network: "solana-mainnet", whirlpoolAddress }`
- `{ kind: "wallet", network: "solana-mainnet", walletAddress }`
- `{ kind: "position", network: "solana-mainnet", walletAddress,
whirlpoolAddress, positionId }`

Addresses and `positionId` are opaque, case-sensitive bounded strings; this
contract does not perform RPC ownership checks. The persistence layer derives a
canonical `scopeKey` from the validated discriminated union for indexing. Scope
identity is never inferred from feature contents.

### Time and lifecycle semantics

All wire timestamps use one canonical UTC representation:
`YYYY-MM-DDTHH:mm:ss.sssZ`. Offsets, missing milliseconds, leap-second strings,
and invalid calendar dates are rejected rather than normalized after receipt.
The semantic validator requires:

```text
asOf <= createdAt < freshUntil <= expiresAt
```

`asOf` is the evidence cutoff, `createdAt` is publisher assembly time,
`freshUntil` is the publisher-declared end of normal freshness, and `expiresAt`
is the hard usability boundary. Regime Engine adds `receivedAt` from its injected
clock; it is storage metadata and is not part of the publisher payload or hash.

At query time, Regime Engine derives, without updating the truth row:

- `FRESH` when `now <= freshUntil`;
- `STALE` when `freshUntil < now <= expiresAt`;
- `EXPIRED` when `now > expiresAt`.

These inclusive boundaries are test vectors. A stale bundle remains observable;
whether it is selectable is deferred to #60. Clock-derived lifecycle state is
response metadata, never persisted into the accepted bundle.

### Deterministic features

`deterministicFeatures` contains at least one and at most 128 items. Each item is
a strict discriminated union with:

- `featureId`: unique within the bundle;
- `family`: `market_state | price_quality | clmm_economics | position_state |
liquidity | risk`;
- `featureKind`: `number | boolean | category`;
- `status`: `available | unavailable | invalid`;
- `value` and `unit` linked to kind/status;
- `observedAt`, `freshUntil`, and `confidenceBps`;
- `calculator: { name, version }`;
- non-empty `inputLineage`, containing referenced source-reference IDs or prior
  deterministic feature IDs;
- `warnings`, an ordered array of stable warning codes.

For `available`, number values are finite JSON numbers, booleans are JSON
booleans, and categories are bounded snake-case strings. Numeric units are a
closed enum: `usd | sol | usdc | percent | basis_points | ratio | seconds |
milliseconds | count | price_usdc_per_sol`. Boolean and category values use
`boolean` and `category` respectively. `count` values are non-negative integers;
`seconds` and `milliseconds` are non-negative; ratios are dimensionless.
Percentage and basis-point feature values may be signed because returns, funding,
and deltas can be negative. Feature-specific ranges belong to the versioned
calculator documentation and later selection policy.

For `unavailable` or `invalid`, both `value` and `unit` are exactly `null`,
`confidenceBps` is 0, and at least one warning is required. An absent metric is
therefore never encoded as numeric zero. `observedAt` and `freshUntil` are null
for `unavailable`; `invalid` may retain the attempted observation timestamps.
Available feature timestamps must satisfy `observedAt <= asOf <= freshUntil`.

`confidenceBps` is always an integer from 0 through 10,000. This bounded field is
distinct from a signed feature whose unit is `basis_points`. Basis points avoid
the ambiguity of a floating confidence fraction and make cross-language vectors
stable.

### Contextual evidence

`contextualEvidence` is always present and has exactly these array properties:

- `supportResistance`
- `flows`
- `derivatives`
- `events`
- `newsRegulatory`

Every array may be empty and is bounded to 64 claims. A claim has a unique
`evidenceId`, family-specific `kind` enum, bounded factual `claim`,
`direction: bullish | bearish | neutral | mixed | unknown`, `confidenceBps`,
`observedAt`, nullable `expiresAt`, one or more `sourceReferenceIds`, and
`provenanceMethod: collected | derived | human_authored`. Claims cannot contain
recommendation, action, allocation, range-width, or final-policy fields.

Array order is publisher-significant and preserved in canonical JSON. Publishers
must emit stable order, recommended as `evidenceId` ascending. Regime Engine does
not reorder accepted payloads because doing so would make the stored payload
differ from what the publisher signed or hashed.

### Research brief

`researchBrief` is either `null` or a strict object containing `briefId`,
`generatedAt`, `summary`, bounded `keyFindings`, bounded `uncertainties`,
`model: { provider, modelId, modelVersion }`, `promptVersion`, and non-empty
`sourceEvidenceIds`. Every referenced ID must resolve to a deterministic feature
or contextual claim in the same bundle.

The brief has no deterministic metric values, recommended action, risk decision,
CLMM posture, allocation, or execution fields. It summarizes bounded evidence
and can never be the only source of a deterministic feature.

### References, assessment, coverage, and provenance

`sourceReferences` is an array of unique records containing `referenceId`,
`sourceType` (closed enum including API, database, chain, document, and internal
bundle), `locator`, nullable `publishedAt`, required `observedAt`, and nullable
lowercase SHA-256 `contentHash`. All lineage/reference IDs used elsewhere must
resolve within this array or, where explicitly allowed, to a feature in the same
bundle. Extra unreferenced source records are allowed for audit completeness.

`assessment` contains:

- `overallConfidenceBps`;
- `quality: complete | partial | degraded`;
- `coverage`, with exactly one status for `deterministic`, each of the five
  contextual families, and `researchBrief`;
- an ordered `warnings` array of strict objects `{ code, message,
affectedFamilies }`.

Coverage values are `available | partial | unavailable | not_applicable`.
`deterministic` cannot be `unavailable` because at least one deterministic
feature is required. Each empty contextual array must have coverage
`unavailable` or `not_applicable`; a non-empty family cannot be `unavailable`.
`researchBrief: null` requires `coverage.researchBrief = "unavailable"` and a
`RESEARCH_BRIEF_UNAVAILABLE` warning. Any unavailable contextual family requires
an affected warning; a deterministic-only fixture uses the aggregate
`CONTEXTUAL_EVIDENCE_UNAVAILABLE` warning. Quality cannot be `complete` if any
required coverage entry is `unavailable`. These rules are semantic validation,
not scoring policy.

`provenance` contains publisher-owned `pipelineVersion`, `gitCommit`,
`environment: production | staging | development | test`, and ordered
`upstreamRunIds`. It describes how the payload was assembled without claiming
Regime Engine accepted or selected it.

## Canonical serialization and hashing

The canonical payload is the entire successfully validated publisher payload;
there is no `payloadHash` field in the request, avoiding a circular hash. The
algorithm is the repository's existing canonical JSON behavior:

1. Serialize objects with keys in ascending UTF-16 code-unit order, matching
   JavaScript `Object.keys(value).sort()`.
2. Preserve array order exactly.
3. Use compact JSON with no insignificant whitespace.
4. Serialize finite numbers using ECMAScript `JSON.stringify` semantics after
   normalizing negative zero to zero.
5. Serialize strings, booleans, and null as JSON primitives; reject unsupported
   values.
6. Compute SHA-256 over the UTF-8 bytes and encode lowercase hexadecimal.

Because timestamps are already canonical on the wire, hashing performs no
hidden timestamp transformation. Regime Engine computes `payloadHash` after
validation and returns/persists it as Regime-owned receipt metadata. The
publisher may precompute the same value for diagnostics but does not supply an
authoritative hash.

Arrays are never sorted by the canonicalizer. Arrays representing sets must be
emitted in documented stable order: IDs ascending for features, claims, and
references; warning code then message ascending; upstream run ID ascending.
Semantic validation rejects duplicate IDs and duplicate set members, but does
not silently reorder them. A different order is a different payload and hash.

Hash vectors include the canonical payload string, UTF-8 byte length, expected
SHA-256, schema SHA-256, and examples covering non-ASCII strings, negative zero,
numeric exponent formatting, empty contextual arrays, and a null brief.

## Persistence model

### Table

Add an append-only Postgres table `regime_engine.evidence_bundles` through a new
Drizzle migration. One row represents one accepted bundle:

```text
id                         bigserial primary key
schema_version             varchar not null
pair                       varchar not null
scope_kind                 varchar not null
scope_key                  varchar not null
source_publisher           varchar not null
source_id                  varchar not null
source_version             varchar not null
run_id                     varchar not null
correlation_id             varchar not null
as_of_unix_ms              bigint not null
created_at_unix_ms         bigint not null
fresh_until_unix_ms        bigint not null
expires_at_unix_ms         bigint not null
received_at_unix_ms        bigint not null
payload_json               jsonb not null
payload_canonical          text not null
payload_hash               char(64) not null
```

`payload_json` is the complete validated publisher payload for efficient typed
rehydration. `payload_canonical` is the exact canonical string used for the hash
and cross-repository audit. Scalar columns are deliberately duplicated only for
identity, lifecycle, and indexed query predicates; they are derived from the
validated payload in one adapter operation. No feature or contextual child rows
are required in v1.

The table has no update/delete repository method and no foreign key to
`clmm_insights`. A future `policy_insights` record may store selected evidence
hashes or IDs as lineage, but it must not reuse or overwrite the bundle's
lineage.

### Constraints and indexes

- Unique idempotency index on
  `(schema_version, source_publisher, source_id, run_id)`.
- Current-read index on
  `(pair, scope_key, source_publisher, source_id, as_of_unix_ms DESC, id DESC)`.
- History index on
  `(pair, scope_key, received_at_unix_ms DESC, id DESC)`.
- Correlation lookup index on `(correlation_id, id DESC)` for diagnostics; it is
  not unique.
- Check constraints enforce timestamp ordering, 64 lowercase hex hash format,
  and known v1 schema/pair values as defense in depth.

Postgres is required for evidence persistence, consistent with current JSONB and
concurrent-read features. This issue does not add a SQLite shadow or fallback;
silently storing different evidence sets by environment would undermine a
single policy authority.

### Repository port and adapter behavior

Define an application-facing `EvidenceBundleRepositoryPort` using contract/domain
types, with a Postgres adapter implementing:

- `append(bundle, canonical, hash, receivedAt)`;
- `getLatest(exactScopeQuery, optionalSource)`;
- `getHistory(exactScopeQuery, page)`.

`append` uses the existing race-safe pattern: insert with conflict-do-nothing,
then load the conflicting identity. Equal stored and incoming payload hashes
return `already_ingested`; different hashes return a typed
`EVIDENCE_RUN_CONFLICT`. Hash equality is sufficient because SHA-256 is the
contract identity, while canonical strings are also compared in tests and may
be compared defensively in the adapter. A losing insert that cannot load the
winner is an invariant error, not an idempotent response.

The operation returns accepted row ID, hash, and original `receivedAt`. A replay
does not replace receipt time or payload bytes. All persistence errors are
atomic: no partial feature/context state exists because the bundle is one row.

### Current and history semantics

Queries require `pair` and one exact validated scope; they never mix pair-level
and position-level evidence implicitly. #60 may deliberately request multiple
scopes and combine candidates.

`getLatest` partitions by publisher/source when no source filter is supplied and
returns at most one latest row per source, ordered by `asOf DESC, receivedAt DESC,
id DESC`. With a source filter it returns at most one row. Results include the
derived `FRESH | STALE | EXPIRED` lifecycle so expired data remains auditable;
selection eligibility is not decided here.

`getHistory` orders by `receivedAt DESC, id DESC`, uses a cursor containing both
values, defaults to 30 items, and rejects limits outside 1 through 100. Cursor
pagination avoids duplicates or skips when new rows arrive. History can filter
by source but always uses exact pair/scope identity. It returns the original
bundle, stored hash, receipt metadata, and derived lifecycle without mutation.

## Ownership of fields and metadata

The intelligence publisher supplies every field in `EvidenceBundleV1`, including
source/run identity, scope, publisher timestamps, evidence, coverage, warnings,
and publisher provenance. Regime Engine validates those claims but does not
rewrite them.

Regime Engine alone calculates and owns:

- database row ID;
- `receivedAt`;
- `payloadCanonical` and `payloadHash` receipt metadata;
- query-time `FRESH | STALE | EXPIRED` lifecycle;
- ingest outcome (`created | already_ingested`) and conflict errors;
- later selection lineage and synthesized policy lineage.

Neither owner may place final recommendation or execution fields in the evidence
payload.

## Machine-readable artifacts

Implementation publishes these stable paths:

```text
contracts/evidence-bundle/v1/evidence-bundle.schema.json
contracts/evidence-bundle/v1/schema.sha256
contracts/evidence-bundle/v1/hash-vectors.json
contracts/evidence-bundle/v1/fixtures/valid/deterministic-only.json
contracts/evidence-bundle/v1/fixtures/valid/contextual.json
contracts/evidence-bundle/v1/fixtures/invalid/*.json
src/contract/evidence/v1/types.generated.ts
src/contract/evidence/v1/validate.ts
docs/contracts/evidence-bundle.v1.md
```

`schema.sha256` contains the lowercase SHA-256 of the schema file bytes followed
by its relative path. The documentation repeats that value and explains how to
recompute it; CI fails if it, the generated type header, or the recorded hash
vectors differ from regeneration. Build asset copying includes the schema,
fixtures, hash vectors, and schema hash under `dist/contracts/...` so a packaged
build does not lose the cross-repository artifacts.

Invalid fixtures cover at least: wrong/missing schema version, unknown fields,
unsupported units, non-canonical/invalid timestamps, reversed lifecycle times,
non-finite or out-of-range numeric values, status/value/unit mismatches,
duplicate/unresolved lineage IDs, malformed contextual families, non-null brief
with unresolved evidence, null brief with successful coverage, empty context
without warnings, and a payload hash vector mismatch.

## Validation and test strategy

### Contract tests

- The deterministic-only fixture validates with at least one available
  deterministic feature, all five contextual arrays empty,
  `researchBrief: null`, explicit unavailable coverage, and both contextual and
  brief warnings.
- The fuller fixture validates contextual claims and a research brief whose
  references all resolve.
- Every invalid fixture fails with stable, sorted error paths and expected codes.
- Unknown properties fail at every object nesting level.
- Boundary tests cover string/array limits, all enums and units, confidence 0 and
  10,000, canonical timestamp precision, and all timestamp equality boundaries.
- Conditional tests cover every feature kind/status/value/unit combination and
  every coverage/absence relationship.
- Generated types and runtime validator are regenerated in CI and produce no
  diff.

### Canonical/hash tests

- Same semantic object-key order produces byte-identical canonical JSON and hash.
- Array reorder changes the hash; exact replay does not.
- The checked-in deterministic-only and contextual vectors reproduce in a clean
  Node process using only published artifact rules.
- Schema file SHA-256 matches `schema.sha256`, documentation, and generated type
  header.
- The existing canonical helper remains the implementation primitive; vectors
  protect its cross-language contract rather than relying only on snapshots.

### Persistence tests

- Create persists the complete payload, scalar identities, canonical text, hash,
  and receipt time exactly once.
- Sequential and concurrent identical replays return one create and one
  idempotent result.
- Sequential and concurrent different-payload replays for the same source/run
  produce a deterministic typed conflict and retain exactly one truth row.
- Different sources or run IDs may publish identical payload content.
- Pair and every scope kind remain isolated in latest/history queries.
- Latest ordering and tie-breakers are deterministic; multi-source current reads
  return one row per source.
- Fresh/stale/expired boundaries are derived without updating stored rows.
- History limit and cursor behavior are bounded and stable under intervening
  inserts.
- Payload rehydration is validated against the v1 schema so corrupt JSONB fails
  visibly rather than leaking malformed evidence to selection.
- A migration test confirms evidence and policy tables are distinct and existing
  insight rows are unchanged.

## Assumptions

- `evidence-bundle.v1` is the canonical version identifier requested by the
  issue; it does not reuse the service-wide `"1.0"` constant because the
  resource has an independent lifecycle.
- The first publisher is `sol-usdc-clmm-intelligence`, and v1 supports only
  `SOL/USDC` on Solana mainnet. Later support requires a new compatible enum
  expansion or a new schema version plus explicit policy.
- The intelligence publisher can emit canonical millisecond UTC timestamps and
  deterministic array ordering.
- Postgres is the durable evidence authority in deployed environments. Local
  contract tests do not require Postgres; adapter integration tests use the
  repository's existing opt-in Postgres suite.
- `freshUntil` and `expiresAt` are publisher claims validated by Regime Engine;
  #60 decides whether source-specific policy shortens those windows.
- Contextual claims may be absent for any run. A deterministic-only bundle must
  not be rejected or withheld solely because context or an LLM brief is absent.
- Source URLs and internal locators may be sensitive, but this issue defines
  persistence rather than public read authorization. #59 must choose exposure
  and redaction policy before adding routes.
- Schema generation and validation dependencies are acceptable because the JSON
  Schema is a required public artifact; dependency choice should support draft
  2020-12 and deterministic generation in the pinned lockfile.

## Risks and concerns

- **Canonical JSON is repository-defined, not RFC 8785.** ECMAScript number
  formatting and Unicode key ordering must be implemented identically by the
  intelligence publisher. Published vectors are load-bearing; calling the
  algorithm merely “canonical JSON” is not sufficient.
- **JSON Schema cannot express every graph invariant.** Reference resolution,
  ID uniqueness, and some coverage relationships require a second semantic
  pass. Keeping both passes behind one validator API prevents callers from
  accidentally persisting structurally valid but semantically invalid bundles.
- **Generated types can overstate conditional precision.** Runtime validation
  remains authoritative. Code should narrow discriminated feature variants
  after validation rather than trusting arbitrary casts.
- **Large JSONB rows can become an abuse or performance vector.** Every string
  and array needs a specified maximum, and #59 should enforce a request body
  limit. The atomic model can be normalized later only if measured selection
  queries require it.
- **Publisher-declared freshness may be optimistic.** Storing both lifecycle
  timestamps and Regime receipt time makes delays visible; #60 must cap or score
  source freshness rather than blindly trusting it.
- **Current semantics can be misunderstood as selection.** The repository returns
  latest rows and lifecycle only. It must not silently discard conflicting,
  stale, or lower-quality sources before #60 records explicit selection reasons.
- **Scope fan-out can leak position identifiers.** Exact-scope indexes and query
  APIs reduce accidental mixing, but HTTP authentication/redaction remains a
  required #59 decision.
- **Existing stores bypass newer application ports.** Reusing their SQL pattern
  is appropriate, but exposing a new `EvidenceBundlesStore` directly through
  HTTP dependencies would deepen architectural debt. The evidence adapter should
  implement an application port from the outset.
- **Append-only is an application convention today.** Database privileges do not
  necessarily forbid updates/deletes. The migration, repository API, and tests
  provide practical enforcement; stronger role-level controls are an operations
  follow-up if required.

## Resulting boundary

```text
sol-usdc-clmm-intelligence
  -> validates against published evidence-bundle.v1 schema
  -> POST is added later by #59

Regime Engine contract/application
  -> strict structural + semantic validation
  -> canonical payload + SHA-256
  -> EvidenceBundleRepositoryPort

Postgres adapter
  -> append-only evidence_bundles row
  -> exact replay or deterministic source/run conflict
  -> exact-scope latest and bounded history

#60 / #61 (later)
  -> select recorded evidence with explicit reasons
  -> synthesize separate canonical PolicyInsight

clmm-v2
  -> consumes PolicyInsight and retains execution authority
```

This boundary allows the deterministic-only MVP to ship immediately, makes
missing research visible rather than fabricated, and preserves a durable audit
trail from publisher evidence to later Regime-owned policy without conflating
the two records.
