# EvidenceBundle v1 Contract Specification

<!-- schema-sha256:0146b073cc607b47e52c615f6299294b1fd8f133d8a4b128bd2a95dc20f77b17 -->

## Schema Identity

- **Schema SHA-256**: `0146b073cc607b47e52c615f6299294b1fd8f133d8a4b128bd2a95dc20f77b17`
- **$id**: `https://contracts.opsclawd.dev/regime-engine/evidence-bundle/v1/evidence-bundle.schema.json`
- **Version**: `evidence-bundle.v1`

## Artifact Paths

All public artifacts are published beneath `dist/contracts/evidence-bundle/v1/`:

| Artifact         | Source Path                                                | Dist Path                                                       |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| JSON Schema      | `contracts/evidence-bundle/v1/evidence-bundle.schema.json` | `dist/contracts/evidence-bundle/v1/evidence-bundle.schema.json` |
| Schema SHA-256   | `contracts/evidence-bundle/v1/schema.sha256`               | `dist/contracts/evidence-bundle/v1/schema.sha256`               |
| Hash Vectors     | `contracts/evidence-bundle/v1/hash-vectors.json`           | `dist/contracts/evidence-bundle/v1/hash-vectors.json`           |
| Valid Fixtures   | `contracts/evidence-bundle/v1/fixtures/valid/`             | `dist/contracts/evidence-bundle/v1/fixtures/valid/`             |
| Invalid Fixtures | `contracts/evidence-bundle/v1/fixtures/invalid/`           | `dist/contracts/evidence-bundle/v1/fixtures/invalid/`           |

## Commands

```bash
# Generate or regenerate all contract artifacts (write mode)
pnpm run contract:evidence:generate

# Check that generated artifacts match source (check mode, CI-safe)
pnpm run contract:evidence:check
```

## Canonical JSON Algorithm

The EvidenceBundle canonicalization is deterministic-only and produces byte-identical output for the same logical content. This is NOT RFC 8785 (which is unavailable in TypeScript native APIs).

### UTF-16 Key Ordering

Object keys are sorted using **UTF-16 code unit order** (same as `Array.prototype.sort()` on strings in JavaScript). This means:

- ASCII characters sort in ASCII order (`a` < `b` < ... < `z`)
- Digits come before uppercase letters in UTF-16 (`0-9` < `A-Z`)
- Lowercase letters sort after uppercase in UTF-16 (`A-Z` < `a-z`)

### Array Preservation

Arrays are **preserved as-is** with original element order. The algorithm never sorts array contents; only object keys are sorted.

### Compact ECMAScript JSON

Numbers are serialized using `JSON.stringify`, which produces:

- No trailing zeros ( `1.20` becomes `1.2`)
- No unnecessary decimal points (`1.0` becomes `1`)
- Lowercase exponent notation (`1.23e4` not `1.23E4`)

### Negative-Zero Normalization

`-0` (negative zero) is normalized to `0`. This is enforced by `Object.is(-0, 0)` being `false` in JavaScript, so we explicitly check and replace:

```typescript
const normalized = Object.is(value, -0) ? 0 : value;
```

### UTF-8 SHA-256

The final canonical string is encoded as **UTF-8** bytes before hashing. The SHA-256 digest is computed over the raw UTF-8 byte representation, producing a 64-character lowercase hex string.

### Canonicalization Pseudocode

```
canonicalize(value):
  if value is null       → "null"
  if value is number     → formatNumber(value)  // handles -0, JSON.stringify
  if value is string     → JSON.stringify(value)
  if value is boolean    → JSON.stringify(value)
  if value is array      → "[" + map(canonicalize, items) + "]"
  if value is object     → "{" + sort(keys).map(k → JSON.stringify(k) + ":" + canonicalize(value[k])) + "}"
```

## Field Ownership

### Publisher-Owned Fields

These fields are set by the evidence **publisher** and are **not** modified by Regime Engine:

| Field                   | Description                                                    |
| ----------------------- | -------------------------------------------------------------- |
| `schemaVersion`         | Must be `"evidence-bundle.v1"`                                 |
| `pair`                  | Must be `"SOL/USDC"`                                           |
| `scope`                 | Scope definition (see Scope section below)                     |
| `source`                | Publisher identity (`publisher: "sol-usdc-clmm-intelligence"`) |
| `runId`                 | Unique run identifier (publisher-owned)                        |
| `correlationId`         | Correlation ID for tracing (publisher-owned)                   |
| `createdAt`             | ISO 8601 timestamp when bundle was created                     |
| `asOf`                  | ISO 8601 timestamp for the data as-of time                     |
| `freshUntil`            | ISO 8601 timestamp when data is considered fresh               |
| `expiresAt`             | ISO 8601 timestamp when bundle expires                         |
| `deterministicFeatures` | Array of deterministic feature results                         |
| `contextualEvidence`    | Contextual evidence families                                   |
| `researchBrief`         | Research brief (or `null` if unavailable)                      |
| `sourceReferences`      | Array of source references                                     |
| `assessment`            | Bundle quality and coverage assessment                         |
| `provenance`            | Pipeline provenance information                                |

### Regime-Owned Fields (Database)

These fields are **appended by Regime Engine** and are not part of the canonical bundle:

| Field              | Description                                   |
| ------------------ | --------------------------------------------- |
| `id`               | Internal row ID ( Regime-assigned)            |
| `receivedAtUnixMs` | Unix timestamp in milliseconds when received  |
| `canonical`        | The canonical JSON string ( Regime-computed)  |
| `payloadHash`      | SHA-256 of canonical string (Regime-computed) |
| `lifecycle`        | Ingest lifecycle status                       |
| `ingestOutcome`    | Outcome of ingest processing                  |
| `selectionLineage` | Future field for selection tracking           |

## Idempotency and Replay

### Canonical Source/Run Idempotency Tuple

A bundle is uniquely identified by the tuple: `(schemaVersion, source.publisher, source.sourceId, runId)`

### Replay Behavior

When the same idempotency tuple is received multiple times:

1. **Identical payload**: The second submission is treated as a no-op (idempotent replay)
2. **Different payload with same tuple**: The second submission is rejected as a conflict

### Conflict Resolution

Conflict detection happens atomically in Postgres:

1. Attempt to insert with the idempotency tuple
2. If duplicate key constraint triggers, read the existing row
3. Compare `payloadHash` values
4. If hashes match → replay (success, no action)
5. If hashes differ → conflict (reject with error)

## Scope and Query Isolation

### Scope Kinds

| Kind        | Fields Required                                                                        | Description                    |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `pair`      | `kind: "pair"`                                                                         | SOL/USDC pair-level scope      |
| `whirlpool` | `kind`, `network: "solana-mainnet"`, `whirlpoolAddress`                                | Whirlpool liquidity pool scope |
| `wallet`    | `kind`, `network: "solana-mainnet"`, `walletAddress`                                   | Wallet scope                   |
| `position`  | `kind`, `network: "solana-mainnet"`, `walletAddress`, `whirlpoolAddress`, `positionId` | Full position scope            |

### Query Isolation

Queries are **strictly scoped** by the scope fields. A query for `scope.kind = "pair"` never returns `scope.kind = "position"` results, even if other scope fields match.

### Latest Ordering

The `latest` query returns the most recent bundle by `receivedAtUnixMs` for a given scope. Ordering is descending by receipt time.

### Cursor Format

Cursors are structured objects containing `receivedAtUnixMs` (Unix timestamp in milliseconds) and `id` (internal row ID). Pagination uses keyset comparison on these fields.

### Limits

- Default page size: 30
- Maximum page size: 100
- Cursor pagination is keyset-based (not offset-based)

### Lifecycle Boundary Table

| Lifecycle Value | Description                                      |
| --------------- | ------------------------------------------------ |
| `FRESH`         | Evidence is within the freshUntil timestamp      |
| `STALE`         | Evidence is past freshUntil but within expiresAt |
| `EXPIRED`       | Evidence is past the expiresAt timestamp         |

## Deterministic-Only Semantics

### Rule: Missing Context/Brief is Unavailable Evidence

When `contextualEvidence` arrays are empty or `researchBrief` is `null`, this represents **unavailable evidence**, NOT zero/success:

- `supportResistance: []` → `coverage.supportResistance: "unavailable"`
- `flows: []` → `coverage.flows: "unavailable"`
- `researchBrief: null` → `coverage.researchBrief: "unavailable"` with warning `RESEARCH_BRIEF_UNAVAILABLE`

### Quality Levels

| Quality    | Meaning                                    |
| ---------- | ------------------------------------------ |
| `complete` | All evidence families available            |
| `partial`  | Some evidence families available           |
| `degraded` | No contextual evidence, only deterministic |

## Evidence Cannot Author Policy

Evidence bundles are **read-only inputs** to the policy pipeline. They explicitly CANNOT:

- Author policy rules
- Make allocation decisions
- Generate trading recommendations
- Cause execution actions

Evidence provides **information** to the policy engine; the policy engine retains full authority over all decisions.

## Publisher Identity

The only valid publisher identity is:

```json
{
  "publisher": "sol-usdc-clmm-intelligence",
  "sourceId": "<string, 1-128 chars>",
  "sourceVersion": "<string, 1-128 chars>"
}
```

Any other publisher value will be rejected by schema validation.
