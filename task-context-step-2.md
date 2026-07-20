# Task Context: Task 2

Title: Enforce semantic validation, immutable hashing, and freshness projection
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

- Create: `src/contract/policyInsight/v1/canonical.ts`
- Create: `src/contract/policyInsight/v1/validate.ts`
- Create: `src/contract/policyInsight/v1/project.ts`
- Create: `src/contract/policyInsight/v1/__tests__/validation.test.ts`
- Create: `src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts`
- Create: `src/contract/policyInsight/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap`
- Create: `src/contract/policyInsight/v1/__tests__/project.test.ts`

**Exported API changes:** Add `PolicyInsightValidationIssue`, `PolicyInsightValidationError`, `parsePolicyInsightContent`, `parsePolicyInsightRead`, `parsePolicyInsightHistoryResponse`, `computePolicyInsightContentCanonicalAndHash`, `projectPolicyInsightRead`, and `projectPolicyInsightHistoryResponse`.

**Behavioral invariants (write these named tests first):**

- `accepts canonical content and rejects every named invalid fixture at its expected path`: structure and semantic validation agree with the fixture matrix.
- `requires asOf <= generatedAt < expiresAt`: any reversed or equal generated/expiry relationship fails semantically.
- `sorts no input and rejects noncanonical level reference reason and warning order`: validation never silently repairs persisted/public data.
- `compares decimal level strings without binary floating point`: supports are strictly descending, resistances strictly ascending, and numeric equality such as `"1"` versus `"1.0"` cannot enter canonical content.
- `requires actions with position semantics to include position identity`: monitor and exit actions fail when `position` is null; pair-scoped `HOLD` and `STAND_DOWN` remain valid.
- `marks freshness fresh immediately before expiry`: `evaluatedAt < expiresAt` yields `FRESH`.
- `marks freshness stale at exact expiry`: equality yields `STALE`.
- `marks freshness stale after expiry`: later evaluation yields `STALE`.
- `computes nonnegative floored age seconds from asOf`: negative age is rejected and fractional seconds floor deterministically.
- `uses one evaluatedAt for every projected history item`: one supplied query instant is projected into the envelope and every item.
- `hashes immutable content without freshness`: changing the read instant never changes content canonical JSON/hash; object-key order does not matter and array order does.

- [ ] **Step 1: Add the failing fixture, semantic, projection, and snapshot tests named above.** Use the published valid fixtures as bases and deep-clone/mutate one condition per case so error paths remain attributable.

- [ ] **Step 2: Run the contract-only tests and observe failures for missing exports.**

  Run: `pnpm exec vitest run src/contract/policyInsight/v1/__tests__/validation.test.ts src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts src/contract/policyInsight/v1/__tests__/project.test.ts`

  Expected: FAIL resolving `canonical.ts`, `validate.ts`, and `project.ts`.

- [ ] **Step 3: Implement canonical hashing.** Reuse the repository's sorted-key canonical JSON and SHA-256 behavior, but expose a content-specific function so freshness cannot be passed accidentally:

  ```ts
  export function computePolicyInsightContentCanonicalAndHash(content: PolicyInsightContent) {
    const canonical = toCanonicalJson(content);
    return { canonical, hash: sha256Hex(canonical) };
  }
  ```

- [ ] **Step 4: Implement AJV structural and explicit semantic validation.** Compile the published schema once with AJV 2020 and validators for the content, read, and history `$defs`. Return typed values only after checking canonical timestamps, timestamp ordering, freshness status/math, arbitrary-precision decimal ordering/uniqueness, action/position compatibility, selected-reference tuple ordering/uniqueness, precedence-then-lexicographic reason order, and code/message warning order. Never coerce, sort, round, or insert defaults.

- [ ] **Step 5: Implement the pure read projectors.** `projectPolicyInsightRead(content, evaluatedAtUnixMs)` must validate a nonnegative integer instant, format it once, compute exclusive-boundary status and floored age, then parse the complete read. `projectPolicyInsightHistoryResponse` must accept already ordered contents plus `limit`, cursor string/null, and one query instant; reuse `projectPolicyInsightRead` for every item and validate the final envelope.

- [ ] **Step 6: Run focused verification and accept snapshots.**

  Run: `pnpm exec vitest run src/contract/policyInsight/v1/__tests__/validation.test.ts src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts src/contract/policyInsight/v1/__tests__/project.test.ts`

  Expected: PASS with stable pair/position canonical JSON and hash snapshots.

- [ ] **Step 7: Commit the contract runtime.**

  ```bash
  git add src/contract/policyInsight/v1/canonical.ts src/contract/policyInsight/v1/validate.ts src/contract/policyInsight/v1/project.ts src/contract/policyInsight/v1/__tests__
  git commit -m "m63: validate and project policy insight v1"
  ```

## Repository Targets

### Expected Files
- src/contract/policyInsight/v1/canonical.ts
- src/contract/policyInsight/v1/validate.ts
- src/contract/policyInsight/v1/project.ts
- src/contract/policyInsight/v1/__tests__/validation.test.ts
- src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts
- src/contract/policyInsight/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap
- src/contract/policyInsight/v1/__tests__/project.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/contract/policyInsight/v1/__tests__/validation.test.ts src/contract/policyInsight/v1/__tests__/canonicalHash.snapshot.test.ts src/contract/policyInsight/v1/__tests__/project.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **fixture matrix validation**: Canonical fixtures pass and every named structural or semantic invalid case fails at its declared path and code. (Test: `accepts canonical content and rejects every named invalid fixture at its expected path`)
- **immutable timestamp order**: Content is valid only when asOf is not after generatedAt and generatedAt is strictly before expiresAt. (Test: `requires asOf <= generatedAt < expiresAt`)
- **canonical order is validated**: The validator rejects rather than repairs noncanonical levels, references, reasons, or warnings. (Test: `sorts no input and rejects noncanonical level reference reason and warning order`)
- **exact decimal comparison**: Level ordering and uniqueness use decimal-string semantics without conversion through binary floating point. (Test: `compares decimal level strings without binary floating point`)
- **action position compatibility**: Monitor and exit actions require a position identity while pair-scoped HOLD and STAND_DOWN are allowed. (Test: `requires actions with position semantics to include position identity`)
- **fresh before expiry**: An evaluation instant strictly before expiresAt produces FRESH. (Test: `marks freshness fresh immediately before expiry`)
- **stale at expiry**: An evaluation instant equal to expiresAt produces STALE. (Test: `marks freshness stale at exact expiry`)
- **stale after expiry**: An evaluation instant after expiresAt produces STALE. (Test: `marks freshness stale after expiry`)
- **age calculation**: ageSeconds is a nonnegative integer equal to the floor of evaluatedAt minus asOf in seconds. (Test: `computes nonnegative floored age seconds from asOf`)
- **shared history instant**: The supplied query instant is used for queriedAt and every history item's evaluatedAt. (Test: `uses one evaluatedAt for every projected history item`)
- **freshness excluded from hash**: Changing only the read instant leaves immutable canonical content and its hash unchanged. (Test: `hashes immutable content without freshness`)

