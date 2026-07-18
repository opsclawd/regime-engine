# Task Context: Task 1

Title: Establish the normative schema and reproducible type-generation toolchain
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

## Repository Targets

### Expected Files
- contracts/evidence-bundle/v1/evidence-bundle.schema.json
- contracts/evidence-bundle/v1/schema.sha256
- scripts/generateEvidenceContract.ts
- src/contract/evidence/v1/types.generated.ts
- src/contract/evidence/v1/__tests__/generation.test.ts
- package.json
- pnpm-lock.yaml

## Validation Commands

```bash
pnpm run contract:evidence:check
pnpm vitest run src/contract/evidence/v1/__tests__/generation.test.ts
pnpm exec prettier --check package.json scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/evidence-bundle.schema.json src/contract/evidence/v1/types.generated.ts src/contract/evidence/v1/__tests__/generation.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **generated artifacts are reproducible**: Check mode derives the same declaration and digest bytes without modifying the worktree. (Test: `keeps generated types and schema digest reproducible`)
- **schema digest has one authority**: The exact schema byte hash matches schema.sha256 and the generated declaration header. (Test: `records the exact schema byte hash in every generated authority marker`)

