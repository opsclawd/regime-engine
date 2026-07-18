# Task Context: Task 2

Title: Add fixtures and unified structural-semantic validation
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

## Repository Targets

### Expected Files
- contracts/evidence-bundle/v1/fixtures/valid/deterministic-only.json
- contracts/evidence-bundle/v1/fixtures/valid/contextual.json
- contracts/evidence-bundle/v1/fixtures/invalid/wrong-schema-version.json
- contracts/evidence-bundle/v1/fixtures/invalid/unknown-field.json
- contracts/evidence-bundle/v1/fixtures/invalid/unsupported-unit.json
- contracts/evidence-bundle/v1/fixtures/invalid/noncanonical-timestamp.json
- contracts/evidence-bundle/v1/fixtures/invalid/reversed-lifecycle.json
- contracts/evidence-bundle/v1/fixtures/invalid/out-of-range-number.json
- contracts/evidence-bundle/v1/fixtures/invalid/status-value-mismatch.json
- contracts/evidence-bundle/v1/fixtures/invalid/duplicate-lineage.json
- contracts/evidence-bundle/v1/fixtures/invalid/unresolved-lineage.json
- contracts/evidence-bundle/v1/fixtures/invalid/malformed-contextual-family.json
- contracts/evidence-bundle/v1/fixtures/invalid/unresolved-brief-evidence.json
- contracts/evidence-bundle/v1/fixtures/invalid/null-brief-available-coverage.json
- contracts/evidence-bundle/v1/fixtures/invalid/empty-context-no-warning.json
- src/contract/evidence/v1/validate.ts
- src/contract/evidence/v1/__tests__/validation.test.ts

## Validation Commands

```bash
pnpm vitest run src/contract/evidence/v1/__tests__/validation.test.ts
pnpm exec eslint src/contract/evidence/v1/validate.ts src/contract/evidence/v1/__tests__/validation.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **deterministic-only acceptance**: A bundle with deterministic evidence, empty context, and a null brief is valid when absence coverage and warnings are explicit. (Test: `accepts deterministic-only evidence with explicit unavailable coverage`)
- **available feature value-kind compatibility**: Available number, boolean, and category features accept only matching value primitives and unit relationships. (Test: `rejects available features whose value does not match featureKind`)
- **missing metrics are not zero**: Unavailable or invalid features use null value/unit, zero confidence, and warnings instead of a fabricated numeric zero. (Test: `rejects unavailable features encoded as numeric zero`)
- **publisher timestamp ordering**: Canonical millisecond UTC timestamps obey root and available-feature lifecycle ordering. (Test: `rejects noncanonical or reversed publisher timestamps`)
- **lineage graph resolution**: Feature, contextual, source-reference, and brief IDs remain unique and every permitted reference resolves without cycles. (Test: `rejects duplicate or unresolved evidence lineage`)
- **coverage reflects actual presence**: Empty context or null research cannot report successful coverage, while present evidence cannot report unavailable coverage. (Test: `rejects coverage that fabricates absent evidence`)

