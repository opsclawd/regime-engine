# Canonical PolicyInsight v1 Wire Contract

**Issue:** #63

**Status:** Proposed design

**Date:** 2026-07-19

## Problem and why it matters

Regime Engine now synthesizes and stores policy insights internally, but its public read shape is still the older handwritten `InsightIngestRequest`. That shape conflicts with the contract required by `clmm-v2`: it identifies itself as generic schema `"1.0"`, uses `maxCapitalDeploymentPercent` as a `0..100` JSON number, exposes singular numeric `levels.support` and `levels.resistance`, uses a different advisory action enum, represents confidence categorically, and mixes machine reason codes, warnings, and prose in one string array.

The drift is not confined to one serializer. The same handwritten types are used by synthesis, PostgreSQL row validation, current/history use cases, handlers, tests, and duplicated OpenAPI objects. `regime_engine.policy_insights.schema_version` already says `policy-insight.v1`, while `synthesis_output_json.schemaVersion` says `1.0`. Consequently, the database label does not prove that a row contains the canonical v1 wire shape.

This matters because `clmm-v2` must consume advice without guessing names, units, or intent. A mistaken percentage conversion can change capital deployment by 100x; an invented zero price level can be interpreted as evidence; and conflating advisory posture with the Regime plan-action contract can make a read response appear to authorize execution. The contract must be strict, independently validateable, pinned to an exact artifact, and emitted identically by current and history reads.

## Repository findings that shape the design

- `src/contract/v1/insights.ts` is a strict Zod schema, but it is an ingest-era contract tied to global `SCHEMA_VERSION = "1.0"`. It is not generated from a published JSON Schema.
- `src/engine/policy/synthesizePolicyInsight.ts` returns that old type. It emits lowercase enums, categorical confidence, percent numbers, numeric price arrays, and fake `[100]`/`[200]` fallback levels when no real level exists.
- Synthesis currently has enough authoritative context to emit the new identity and decision context: the repository record carries `insightId`, `rulesetVersion`, scope, timestamps, selection policy/version, input lineage, and payload hashes.
- The existing action reducer distinguishes hard-stale/stand-down, lower and upper position breaches, cooldown, and ordinary hold/watch conditions. The canonical action mapping must happen there, where context exists, rather than in an HTTP serializer.
- `SelectedEvidenceSummary` already provides selection mode, selected bundle identities, selected source references, conflicts, and warnings. The public contract can project a bounded subset without exposing excluded audit lineage.
- `GET /current` computes freshness with `Date.now()` even though its use case returns an injected-clock `queriedAtUnixMs`; history emits no per-item freshness. A single read instant must drive both endpoints.
- Current and history already read only `regime_engine.policy_insights`, order by `(generatedAtUnixMs DESC, id DESC)`, and use keyset history pagination. Those behaviors can remain.
- Existing rows cannot be assumed to satisfy this contract. They share the `policy-insight.v1` database label but contain legacy JSON. Rewriting or heuristically converting them would obscure historical truth.
- The EvidenceBundle contract establishes the repository pattern to reuse: draft 2020-12 JSON Schema as source of truth, generated TypeScript, AJV structural validation plus explicit semantic validation, valid/invalid fixtures, schema SHA-256, generated-artifact drift checks, contract documentation, and build-time asset copying.
- OpenAPI currently repeats separate handwritten current/history schemas and even contains drift such as a duplicated `confidence` requirement. Importing the canonical schema definitions removes this second source of truth.

## Design goals

- Publish one closed `policy-insight.v1` read-item shape used by both current and history.
- Make every public name, enum, unit, bound, nullability rule, ordering rule, and timestamp/freshness relationship explicit.
- Generate TypeScript from the JSON Schema and validate all stored/read projections against it.
- Preserve append-only historical truth while ensuring only verified canonical rows appear on canonical reads.
- Give `clmm-v2` a reproducible artifact set and exact pinning metadata.
- Keep the advisory contract visibly separate from execution plans and transaction submission.

## Approaches considered

### 1. Schema-first contract package with an explicit read projection — recommended

Create a dedicated `contracts/policy-insight/v1/` package. Its JSON Schema owns the immutable insight fields, the read-time freshness block, and the history envelope through `$defs`. Generate TypeScript from it, validate structural and semantic invariants at synthesis/persistence/read boundaries, and import its definitions into OpenAPI. Add an explicit persistence marker for rows written under the new wire contract; canonical queries ignore unmarked legacy rows.

This follows the proven EvidenceBundle pattern, eliminates handwritten shape duplication, and avoids altering old records. The trade-off is an additive migration and a temporary period in which an installation with only old rows returns no canonical current insight until the next synthesis.

### 2. Keep Zod authoritative and generate JSON Schema from it

This minimizes changes around `src/contract/v1/insights.ts`, but the repository has no established Zod-to-schema generation path and downstream consumers need JSON Schema, not Regime Engine's runtime library. It also encourages continued coupling between the generic API `1.0` contract and `PolicyInsight v1`. This approach is rejected.

### 3. Convert legacy rows to the new shape on every read or in a data backfill

Mechanical conversions exist for percent-to-basis-points and number-to-string levels, but recommended actions, missing evidence status, missing position identity, and fake fallback levels cannot be reconstructed safely. A backfill would silently rewrite historical meaning; a read adapter would make canonical output depend on guesses. This approach is rejected. Legacy rows remain unchanged and excluded from canonical reads.

## Proposed contract

### Artifact identity and versioning

The canonical source is:

```text
contracts/policy-insight/v1/policy-insight.schema.json
```

Its `$id` is:

```text
https://contracts.opsclawd.dev/regime-engine/policy-insight/v1/policy-insight.schema.json
```

Every insight and history envelope uses exactly:

```json
"schemaVersion": "policy-insight.v1"
```

The schema is JSON Schema draft 2020-12. The root validates one `PolicyInsightRead`; named `$defs` expose `PolicyInsightContent`, `PolicyInsightFreshness`, and `PolicyInsightHistoryResponse` for OpenAPI and direct fragment validation. Every object sets `additionalProperties: false`; every field is required unless this design explicitly marks it nullable. V1 permits no extension bag and no unknown enum value. A new field or enum value therefore requires a new contract version and artifact path rather than loosening v1.

### Canonical read item

Both `GET /v1/insights/sol-usdc/current` and each history `items[]` entry use the same `PolicyInsightRead` object:

| Field               | Type and rule                                                           | Meaning                                                             |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `schemaVersion`     | const `policy-insight.v1`                                               | Wire schema identity, independent of the generic API error version. |
| `insightId`         | 64 lowercase hex characters                                             | Stable synthesized-insight identity from the stored record.         |
| `rulesetVersion`    | string, 1..64                                                           | Exact policy ruleset that authored the advice.                      |
| `pair`              | const `SOL/USDC`                                                        | Only supported pair in v1.                                          |
| `position`          | strict object or `null`                                                 | Optional position identity; never omitted.                          |
| `generatedAt`       | canonical timestamp                                                     | When Regime Engine synthesized the insight.                         |
| `asOf`              | canonical timestamp                                                     | Latest instant represented by its authoritative inputs.             |
| `expiresAt`         | canonical timestamp                                                     | Exclusive freshness boundary.                                       |
| `marketRegime`      | `UP`, `DOWN`, `CHOP`                                                    | Regime Engine market classification.                                |
| `fundamentalRegime` | `BULLISH`, `BEARISH`, `NEUTRAL`, `UNKNOWN`                              | Bounded evidence-derived fundamental state.                         |
| `posture`           | `AGGRESSIVE`, `MODERATELY_AGGRESSIVE`, `NEUTRAL`, `DEFENSIVE`, `PAUSED` | Overall advisory posture.                                           |
| `recommendedAction` | closed advisory enum below                                              | Advice only; not a plan action or execution request.                |
| `riskLevel`         | `NORMAL`, `ELEVATED`, `CRITICAL`                                        | Policy risk classification.                                         |
| `clmmPolicy`        | strict object                                                           | CLMM-specific range, sensitivity, and deployment limits.            |
| `levels`            | strict object                                                           | Explicit-unit support/resistance decimal strings.                   |
| `evidence`          | strict object                                                           | Selection status and selected lineage references.                   |
| `confidenceBps`     | integer `0..10_000`                                                     | Confidence in basis points.                                         |
| `dataQuality`       | `COMPLETE`, `PARTIAL`, `STALE`                                          | Worst relevant authoritative data state.                            |
| `reasonCodes`       | unique closed-enum array, 1..16                                         | Machine-readable ordered decision causes.                           |
| `reasoning`         | string, 1..2048                                                         | Concise deterministic human explanation.                            |
| `warnings`          | unique strict warning array, 0..16                                      | Non-fatal limitations and degradation.                              |
| `freshness`         | strict object                                                           | Read-time status evaluated from stored timestamps.                  |

`position` is either `null` for pair-scoped advice or:

```json
{
  "network": "solana-mainnet",
  "walletAddress": "...",
  "whirlpoolAddress": "...",
  "positionId": "..."
}
```

Each identifier is a non-empty string of at most 128 characters. Keeping the full position identity, rather than only `positionId`, makes the response match the scope key already used by current/history queries and prevents identity collision across wallets or pools.

All timestamps must use exactly UTC ISO 8601 with millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`). Offset variants and timestamps without milliseconds fail. Semantic validation enforces:

```text
asOf <= generatedAt < expiresAt
generatedAt <= freshness.evaluatedAt
```

### Advisory action enum

The only v1 values are:

```text
HOLD
MONITOR_LOWER_BOUND
MONITOR_UPPER_BOUND
EXIT_TO_USDC
EXIT_TO_SOL
STAND_DOWN
```

These values describe posture. They never authorize a swap, liquidity removal, signing operation, or transaction submission. The contract contains no transaction, route, slippage, wallet-approval, signature, or execution-status field.

The synthesis reducer must emit these values directly; serializers must not infer them from legacy strings. The minimal mapping of existing behavior is:

- hard-stale, blocked-suitability, or active stand-down -> `STAND_DOWN`;
- qualified lower-bound breach -> `EXIT_TO_USDC`;
- qualified upper-bound breach -> `EXIT_TO_SOL`;
- unqualified below-range observation -> `MONITOR_LOWER_BOUND`;
- unqualified above-range observation -> `MONITOR_UPPER_BOUND`;
- pair-scoped or in-range advice with no higher guard -> `HOLD`.

This design assumes exit values name the desired post-exit asset: a downside breach de-risks to USDC and an upside breach retains SOL exposure. This is a v1 policy assumption, not a serializer heuristic, and must be locked by reducer fixtures.

### CLMM policy and numeric units

`clmmPolicy` is:

```json
{
  "rangeBias": "TIGHT | MEDIUM | WIDE | PASSIVE",
  "rebalanceSensitivity": "LOW | NORMAL | HIGH | PAUSED",
  "maxCapitalDeploymentBps": 0
}
```

`maxCapitalDeploymentBps` is an integer from `0` through `10_000`, inclusive. No `Pct`, `Percent`, ratio, or floating-point alias exists. The reducer's current integer percent is temporarily mapped inside the versioned policy layer as `percent * 100`; the mapping rejects non-integer, non-finite, or out-of-range input rather than rounding. New synthesis code should operate in basis points natively.

`confidenceBps` has the same integer bounds. Until the policy ruleset computes native basis points, the existing categories map in the versioned reducer as `low = 2_500`, `medium = 5_000`, and `high = 7_500`. This temporary mapping is deterministic and documented; changing it requires a ruleset-version change even though the wire schema remains v1.

### Price levels

`levels` is always present:

```json
{
  "supportsUsdcPerSol": [],
  "resistancesUsdcPerSol": []
}
```

Both arrays contain zero through 16 unique, positive decimal strings. The lexical form is canonical: no sign, exponent, leading zero except `0.x`, trailing decimal point, or trailing fractional zero. Examples are `"138"`, `"138.5"`, and `"0.000001"`; invalid examples include `"0138.5"`, `"138.50"`, `"1e2"`, `"+1"`, `"0"`, JSON number `138.5`, `null`, and an empty string. Strings are limited to 64 characters.

Semantic validation requires supports in strictly descending numeric order and resistances in strictly ascending numeric order. Empty arrays mean no eligible evidence. Synthesis removes the current fake `[100]`/`[200]` fallbacks. It may serialize only real, allowlisted `price_usdc_per_sol` inputs; position bounds and numbers parsed from research prose are not relabeled as support/resistance evidence.

### Evidence selection projection

`evidence` is always present:

```json
{
  "selectionStatus": "FULL | PARTIAL | DEGRADED",
  "selectionPolicyVersion": "...",
  "selectedBundleRefs": [],
  "selectedSourceRefs": []
}
```

The existing selector maps `FULL` to `FULL`, `PARTIAL` to `PARTIAL`, and `DEGRADED_NO_RESEARCH` to `DEGRADED`. A selected bundle reference contains exactly `bundleHash`, `publisher`, `sourceId`, and `runId`. A selected source reference contains exactly `referenceId`, `sourceType`, `locator`, and canonical `observedAt`. Only selected lineage (`isSelectedLineage = true`, `isAuditOnly = false`) is exposed. Excluded decisions remain in PostgreSQL audit JSON and do not inflate the public response.

References are deduplicated and lexicographically ordered by their full identity tuple before hashing/persistence. Both arrays may be empty; empty means no selected evidence, not a fabricated source.

### Reasons, reasoning, warnings, and data quality

V1 reason codes are closed to the rules already present in `sol-usdc-policy.v1` plus explicit contract/degradation outcomes:

```text
ADVISORY_ONLY
DATA_HARD_STALE
DATA_INSUFFICIENT_SAMPLES
CLMM_BREACH_LOWER
CLMM_BREACH_UPPER
CHURN_STAND_DOWN_ACTIVE
CHURN_COOLDOWN_ACTIVE
MARKET_REGIME_UP
MARKET_REGIME_DOWN
MARKET_REGIME_CHOP
FEATURE_THRESHOLD_BREACHED
CONTEXTUAL_EVIDENCE_VOTE
RESEARCH_BRIEF_ANALYSIS
NO_ELIGIBLE_PRICE_LEVELS
```

`reasonCodes` is deduplicated and ordered by the ruleset's precedence, then lexicographically for equal precedence. `reasoning` is rendered from fixed templates and bounded identifiers; it is not arbitrary research prose and does not duplicate warning messages.

Each warning has exactly `{ "code": ..., "message": ... }`. V1 warning codes are `MARKET_DATA_HARD_STALE`, `EVIDENCE_STALE_INPUT`, `EVIDENCE_MISSING_FAMILY`, `EVIDENCE_REJECTED_FAMILY`, `EVIDENCE_CONFLICTED_FAMILY`, `EVIDENCE_NO_SELECTED_RESEARCH`, and `NO_ELIGIBLE_PRICE_LEVELS`. Warnings are deduplicated and sorted by code then message. Unknown codes fail closed.

`dataQuality` maps the worst relevant condition: hard-stale market data produces `STALE`; otherwise degraded/partial evidence or soft-stale authoritative input produces `PARTIAL`; otherwise it is `COMPLETE`. A missing research brief is a warning and may make evidence selection degraded, but is never represented as zero confidence or fake evidence.

### Freshness

Freshness is a read projection, not part of the immutable synthesized content:

```json
{
  "status": "FRESH | STALE",
  "evaluatedAt": "2026-07-19T12:00:00.000Z",
  "ageSeconds": 42
}
```

The current and history use cases capture one `queriedAtUnixMs` from the injected `ClockPort` and apply it to every returned item. They do not call `Date.now()` in a handler. Status is `FRESH` iff `evaluatedAt < expiresAt`; equality is `STALE`. `ageSeconds` is `floor((evaluatedAt - asOf) / 1000)` and must be a non-negative integer. Semantic validation checks all three values for consistency.

The immutable content hash and insight identity do not change as freshness ages. The read response therefore must not claim that its complete dynamic bytes are the stored payload hash. The existing public `payloadHash` and misleading `receivedAtIso` fields are removed from v1; internal canonical hashes and persistence timestamps remain available for audit.

### History envelope

History returns:

```json
{
  "schemaVersion": "policy-insight.v1",
  "pair": "SOL/USDC",
  "queriedAt": "2026-07-19T12:00:00.000Z",
  "limit": 50,
  "items": [],
  "nextCursor": null
}
```

`limit` is an integer `1..100`, aligning the HTTP parser with the repository's existing maximum (the current parser incorrectly allows 200). `nextCursor` is the only nullable envelope field. Ordering and the opaque versioned cursor remain `(generatedAtUnixMs DESC, id DESC)`. Each item is the exact same `PolicyInsightRead` used by current, including freshness evaluated at `queriedAt`.

The current endpoint returns a `PolicyInsightRead` directly. No row remains `404 INSIGHT_NOT_FOUND`; unavailable PostgreSQL remains `503 SERVICE_UNAVAILABLE`. Existing API error envelopes are not PolicyInsight payloads and retain the generic API `schemaVersion: "1.0"` until the API error contract is versioned separately.

## Runtime architecture and data flow

### Contract package

Add `src/contract/policyInsight/v1/` rather than extending generic `src/contract/v1/insights.ts`:

- `types.generated.ts` is generated from the JSON Schema and is never hand-edited.
- `validate.ts` compiles the schema once with AJV 2020 and adds semantic checks for timestamp relationships, freshness consistency, decimal ordering/uniqueness, action/position compatibility, reference ordering, and reason/warning ordering.
- `project.ts` maps a validated stored canonical record plus one query instant to `PolicyInsightRead`. It performs no policy inference and no legacy conversion.

The legacy contract remains isolated only while issue #62 removes the external POST path. Canonical synthesis, persistence validation, current/history use cases, handlers, fixtures, and OpenAPI must import the new package. No new canonical code imports `InsightIngestRequest`.

### Synthesis and persistence mapping

The pure reducer returns immutable `PolicyInsightContent`, including `schemaVersion`, insight/ruleset identity, scope identity, timestamps, canonical enums, basis points, decimal-string levels, evidence projection, reasons, reasoning, and warnings. It does not include read-time freshness.

Because `insightId` is currently computed by the application around the reducer, either the application supplies it in the reducer envelope or completes a strict content draft immediately after reduction and validates the final content before hashing. There must be only one final validation/canonicalization path.

Add a nullable `wire_contract_sha256` column to `policy_insights`. New canonical rows set it to the exact schema SHA-256 and store canonical `PolicyInsightContent` in `synthesis_output_json`; existing rows remain `NULL`. Current/history repository queries filter on both `schema_version = 'policy-insight.v1'` and the supported `wire_contract_sha256`. No existing `synthesis_output_json`, canonical string, hash, or schema label is backfilled.

This marker distinguishes contract generations without creating a second insight table or pretending old rows were canonical. The next successful synthesis creates a new marked row. If idempotency finds an old unmarked row with the same synthesis input hash, it must not return it as canonical: the unique key must include the wire-contract digest (via a replacement index) so the canonical projection can be inserted once alongside the old row.

Repository row loading validates JSON with the new content validator and recomputes its canonical hash before returning it. A marked row that fails validation is treated as stored-data corruption and produces an internal error; it is never partially serialized.

### Read flow

1. The current/history use case captures `queriedAtUnixMs` once through `ClockPort`.
2. The repository selects only rows marked with the supported contract digest.
3. The repository validates immutable stored content and hash invariants.
4. The application projection adds freshness from the shared query instant and validates the complete `PolicyInsightRead`.
5. The handler sends that object unchanged. It only parses query parameters/cursors and maps application errors.

This keeps time, validation, and policy out of HTTP adapters and preserves the existing clean-architecture direction.

## Machine-readable artifacts and downstream handoff

Publish the following beneath `contracts/policy-insight/v1/`, and copy the directory byte-for-byte to `dist/contracts/policy-insight/v1/` during build:

- `policy-insight.schema.json` — authoritative schema and `$defs`;
- `schema.sha256` — SHA-256 over the exact schema bytes and repository-relative path;
- `fixtures/valid/current-pair.json`, `current-position.json`, and `history.json`;
- invalid fixtures for legacy field names, numeric or malformed levels, noncanonical timestamps, impossible timestamp/freshness relationships, wrong units/types, basis points below 0/above 10,000/non-integer, every invalid enum class, action without required position identity, unknown fields at every nesting level, duplicate/out-of-order arrays, and an unsupported schema version.

Add `scripts/generatePolicyInsightContract.ts` with `--write` and `--check`, mirroring `generateEvidenceContract.ts`. It generates types, schema digest, and formatted fixtures/metadata reproducibly. Add `contract:policy-insight:generate` and `contract:policy-insight:check`; the latter runs in the normal test/build quality gate.

`docs/contracts/policy-insight.v1.md` documents every field and invariant, artifact source/dist paths, the schema digest marker, generation/check commands, advisory authority, hashing boundaries, versioning, and consumer instructions. The implementation PR records the source commit SHA; after merge, the clmm-v2 #92 handoff pins the merged commit SHA together with schema path, `policy-insight.v1`, and schema SHA-256. The commit SHA is release provenance rather than content embedded in the commit itself, avoiding a circular self-reference.

OpenAPI imports the canonical JSON Schema once. `InsightCurrentResponse` references the root and `InsightHistoryResponse` references its `$defs` fragment. Examples are loaded from the valid fixtures, so OpenAPI cannot silently drift from the artifact package.

## Compatibility and rollout

- Canonical current/history responses cut directly to the new shape; there is no query flag, content negotiation fallback, old-field alias, or silent unit conversion.
- Existing unmarked `policy_insights` rows remain append-only audit records and are excluded. This is an intentional compatibility boundary documented in the contract guide and deployment notes.
- Deploy schema migration and code before requiring clmm-v2 consumption. Trigger one canonical synthesis per required scope, verify marked current/history rows, then update clmm-v2 to its pinned artifacts.
- The legacy `POST /v1/insights/sol-usdc` and `clmm_insights` table are owned by #62. While they exist, documentation labels them legacy and they never feed canonical reads. This issue does not create a mapper between the legacy POST payload and PolicyInsight v1.
- A future PolicyInsight version gets a new schema path/digest and explicit serving strategy. V1 remains closed forever.

## Testing strategy

### Contract tests

- Validate every valid fixture against both JSON Schema and semantic validation.
- Prove every invalid fixture fails for the intended path/code, including all drift named in the issue.
- Verify generated types, schema digest, docs digest markers, and dist assets are reproducible and current.
- Snapshot canonical JSON for pair and position content; prove object key order does not change the hash and array order does.
- Assert decimal-string normalization, numeric ordering, uniqueness, bounds, and empty-array semantics.

### Domain and application tests

- Update reducer fixtures to emit the six canonical actions directly and prove lower/upper exit direction.
- Prove hard-stale/stand-down precedence maps to `STAND_DOWN`; pair/in-range maps to `HOLD`.
- Prove percentage and confidence mappings produce integer basis points and reject invalid intermediate values.
- Prove absence of structured level evidence produces empty arrays and `NO_ELIGIBLE_PRICE_LEVELS`, never fallback numbers.
- Verify position identity, selected bundle/source projection, reason ordering, warning mapping, and strict output validation.
- Use a fake clock to test just-before/equal/after expiry boundaries and shared current/history `evaluatedAt`; assert handlers never use wall-clock time independently.

### Persistence, HTTP, and OpenAPI tests

- Migration tests cover nullable legacy markers, required markers on new writes, and the digest-aware idempotency unique index.
- Prove unmarked rows remain unchanged and never appear in current/history.
- Prove marked malformed rows fail closed rather than leaking partial output.
- Current/history contract tests compare exact response keys and validate the full response against the published schema fragments.
- Prove current and first history item agree under the same query instant/order and that pagination has no gaps/duplicates.
- Test the aligned history limit maximum of 100 and existing 400/404/503 error behavior.
- Verify OpenAPI schema fragments and examples are the published artifacts, not handwritten lookalikes.

The implementation quality gate remains `pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build`, with PostgreSQL integration tests and boundary checks run where configured.

## Assumptions

- `PolicyInsight v1` supports only `SOL/USDC`, pair and position reads, and the current two endpoint paths.
- All canonical success fields are required. Only `position` and history `nextCursor` are nullable; arrays represent absence with `[]`.
- Lower-bound exits target USDC and upper-bound exits target SOL. This is explicitly a v1 policy decision and will be fixture-locked.
- Categorical confidence survives only as an internal transitional input with the fixed 2,500/5,000/7,500 basis-point mapping.
- The immutable insight content, not dynamic freshness bytes, is what persistence hashes. `insightId` is the public stable identity.
- Contextual support/resistance prose and position range bounds are not valid price-level evidence. Only allowlisted structured `price_usdc_per_sol` inputs may populate the arrays.
- The existing `policy_insights` table may contain real legacy rows and must not be emptied or rewritten during rollout.
- clmm-v2 will pin repository commit SHA plus schema SHA-256 rather than receiving an independently maintained handwritten TypeScript copy.
- #62 remains responsible for deleting the external final-policy POST; #63 only isolates it from canonical reads.

## Scope

### In scope

- Exact PolicyInsight v1 success schemas for current items and history envelope.
- JSON Schema, generated/schema-tied TypeScript, semantic validator, digest, fixtures, docs, OpenAPI references/examples, build artifacts, and downstream pinning metadata.
- Minimal reducer/output changes needed to produce canonical enums, basis points, real decimal-string level arrays, evidence projection, reason codes, warnings, and identities.
- Current/history projection, shared-clock freshness, query limit alignment, strict serialization, and regression tests.
- Additive persistence metadata/index changes that distinguish canonical rows without rewriting history.

### Explicitly out of scope

- Evidence ingestion (#59), evidence selection/scoring (#60), or evidence-contract changes.
- New synthesis policy/precedence or research interpretation (#61), beyond the mechanical/explicit mappings required by this wire contract.
- clmm-v2 implementation (#92) or publishing an independent downstream contract.
- Removing the legacy final-policy write route/table (#62), except documenting and isolating it.
- Execution-plan action contracts, trigger qualification, safety approval, signing, routing, swaps, liquidity operations, or transaction submission.
- Multi-pair support, wallet/pool scope expansion beyond the current pair/position reads, content negotiation, or a general schema registry.
- Backfilling, coercing, or presenting legacy policy rows as canonical v1.

## Risks and concerns

### Existing rows are mislabeled at the database level

`policy_insights.schema_version` already contains `policy-insight.v1` for legacy-shaped output. Filtering only by that column would leak old names after rollout. The schema-digest marker and digest-aware uniqueness are required, not optional migration polish.

### Action direction encodes a policy assumption

The old `exit_range` action does not state a target asset. This design fixes lower-to-USDC and upper-to-SOL as v1 semantics, which changes the old behavior. The mapping must be encoded in the reducer with scenario tests; no generic legacy adapter can infer it safely. Reversing this decision later requires a #61 ruleset change before contract rollout, while the wire enum stays unchanged.

### Dynamic freshness can undermine determinism

Hashing a response that includes `ageSeconds` would produce a different hash every read. Keeping freshness as an explicitly un-hashed read projection preserves stable insight identity. Consumers must not use full-response byte equality as content identity.

### Decimal strings require semantic validation

JSON Schema can enforce lexical form but not reliable arbitrary-precision numeric ordering or cross-item uniqueness. The official validator must implement those invariants without converting through binary floating point. Downstream consumers should use schema validation for structure and either reuse the fixtures/algorithm or preserve the strings as decimals.

### JSON Schema cannot express all cross-field relationships

Timestamp ordering, exact freshness math, some action/position compatibility, and ordered reason precedence require semantic validation. The schema documents these invariants with descriptions and the contract docs; invalid fixtures and the official validator make them executable. Claiming the raw schema alone enforces them would be misleading.

### Contract release ordering can create a temporary 404

Old rows are intentionally excluded, so canonical reads may be empty immediately after deployment. Rollout must synthesize and verify at least one marked row for every required scope before clmm-v2 switches. Falling back to legacy output would defeat the fail-closed contract.

### Handwritten OpenAPI is currently a drift source

Maintaining new schema objects beside imported JSON Schema would recreate the problem, especially across current and history. Implementation must reference/import the artifact definitions and load examples from fixtures, even if that requires a small OpenAPI schema adapter.

### Reason/warning enums couple schema and ruleset evolution

Closed enums are intentionally fail-closed, but a genuinely new public reason or warning requires a PolicyInsight schema version change. Ruleset-only changes may adjust when existing codes occur, confidence values, or reasoning text without changing the wire schema; they may not invent public enum values.

## Acceptance mapping

| Issue requirement           | Design mechanism                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| One strict schema/version   | `policy-insight.v1`, draft 2020-12 artifact, closed objects/enums                                                           |
| Basis-point fields          | Integer `maxCapitalDeploymentBps` and `confidenceBps`, `0..10_000`                                                          |
| Explicit price levels       | Canonical positive decimal-string `supportsUsdcPerSol` / `resistancesUsdcPerSol`, arrays may be empty                       |
| Closed advisory action      | Six uppercase advisory values emitted by the reducer; no execution fields                                                   |
| Full decision context       | Identity, ruleset, pair/position, timestamps, regimes, posture, risk, CLMM, evidence, quality, reasons, warnings, freshness |
| No adapter guessing         | Reducer emits canonical semantics; handlers send validated projections unchanged                                            |
| Current/history exactness   | Shared `PolicyInsightRead`, schema-fragment validation, common clock/order                                                  |
| Legacy names/units rejected | Negative fixtures; unmarked historical rows excluded, not converted                                                         |
| Artifact handoff            | Schema, generated types, valid/invalid fixtures, digest, docs, OpenAPI examples, commit/SHA pinning                         |
| Freshness explicit/tested   | Injected shared query time, exclusive expiry boundary, deterministic semantic checks                                        |
