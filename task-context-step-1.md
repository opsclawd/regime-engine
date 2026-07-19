# Task Context: Task 1

Title: Define and validate the versioned selection policy
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-60
Repository: opsclawd/regime-engine
Branch: ai/issue-60
Start Commit: 6a6956b3c169a8146d22f1b8f77b7c27de35d1b5

## Task Requirements

**Files:**

- Create: `src/engine/evidence/selectionPolicy.ts`
- Create: `src/engine/evidence/__tests__/selectionPolicy.test.ts`

**Exported API surface:** Add `EvidenceSelectionPolicy`, `ProvenanceClass`, `EvidenceSelectionReasonCode`, `EvidenceSelectionWarningCode`, `EVIDENCE_SELECTION_POLICY_VERSION`, `EVIDENCE_SELECTION_POLICY_V1`, `evidenceSourceQualityKey`, and `validateEvidenceSelectionPolicy`. These declarations and their tests belong in this task; no port or adapter changes are involved.

**Behavioral invariants to write as tests first:**

- `ships the conservative immutable v1 policy values`: version is `evidence-selection.v1`, minimum score is `2_500`, stale weight is `5_000`, family cap is `16`, default source quality is `5_000`, provenance is calculator `10_000`, derived `9_000`, collected `8_000`, human-authored `7_000`, and the reviewed-source map is empty.
- `qualifies source quality keys without publisher/source collisions`: publisher and source ID are encoded with length prefixes (for example `${publisher.length}:${publisher}${sourceId.length}:${sourceId}`), so delimiter-bearing identities cannot alias.
- `rejects non-finite or out-of-range policy basis points`: every bps field and source override must be a finite integer in `[0, 10_000]`.
- `rejects zero or non-integer family limits and blank versions`: `maxSelectedPerFamily` must be a positive integer and `version` must contain non-whitespace text.
- `does not permit mutation of the shipped policy`: nested maps are copied/frozen (or otherwise exposed read-only without a mutable backing object) so one caller cannot alter later selections.

- [ ] **Step 1: Write the failing policy tests**

  Create `selectionPolicy.test.ts` with the exact test names above. For collision safety, compare keys for identities such as `("ab", "c")` and `("a", "bc")`; for validation, table-drive every scalar boundary (`-1`, `10_001`, `1.5`, `NaN`, `Infinity`) plus an invalid per-source override. Assert `validateEvidenceSelectionPolicy` throws `TypeError` with a field-qualified message.

- [ ] **Step 2: Run the focused tests and observe the missing module failure**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectionPolicy.test.ts`

  Expected: FAIL because `selectionPolicy.ts` and its exports do not exist.

- [ ] **Step 3: Implement policy types, constants, keys, and validation**

  Use integer bps throughout and define the public shape explicitly:

  ```ts
  export type ProvenanceClass =
    | "deterministic_calculator"
    | "derived"
    | "collected"
    | "human_authored";

  export interface EvidenceSelectionPolicy {
    readonly version: string;
    readonly minimumEffectiveScoreBps: number;
    readonly staleWeightBps: number;
    readonly maxSelectedPerFamily: number;
    readonly defaultSourceQualityBps: number;
    readonly sourceQualityBps: Readonly<Record<string, number>>;
    readonly provenanceQualityBps: Readonly<Record<ProvenanceClass, number>>;
  }

  export const EVIDENCE_SELECTION_POLICY_VERSION = "evidence-selection.v1" as const;
  ```

  Include stable reason-code unions for record mismatch, bundle expiry/disablement, feature unavailable/invalid/dependency failure, claim expiry, score threshold, family cap, brief unavailable/citation failure, and fresh/stale inclusion. Include warning-code unions for stale input, missing/rejected/conflicted families, and no selected research. `validateEvidenceSelectionPolicy` must validate a copied policy before selection starts and return an immutable normalized policy; do not consult `process.env`.

- [ ] **Step 4: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectionPolicy.test.ts`

  Expected: PASS with all five named invariants.

  Run: `pnpm exec eslint src/engine/evidence/selectionPolicy.ts src/engine/evidence/__tests__/selectionPolicy.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The implement loop also runs its automatic workspace `pnpm -r typecheck` gate.

- [ ] **Step 5: Commit the independently usable policy unit**

  ```bash
  git add src/engine/evidence/selectionPolicy.ts src/engine/evidence/__tests__/selectionPolicy.test.ts
  git commit -m "m60: define evidence selection policy"
  ```

## Repository Targets

### Expected Files
- src/engine/evidence/selectionPolicy.ts
- src/engine/evidence/__tests__/selectionPolicy.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/evidence/__tests__/selectionPolicy.test.ts
pnpm exec eslint src/engine/evidence/selectionPolicy.ts src/engine/evidence/__tests__/selectionPolicy.test.ts --max-warnings 0
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **v1 policy constants**: The shipped immutable policy uses the reviewed v1 version, threshold, stale weight, cap, default source quality, provenance weights, and no invented source override. (Test: `ships the conservative immutable v1 policy values`)
- **collision-safe source identity**: Publisher and source ID are length-qualified so distinct identity pairs cannot map to the same policy lookup key. (Test: `qualifies source quality keys without publisher/source collisions`)
- **basis-point validation**: Every policy bps value, including exact-source overrides, is a finite integer from zero through ten thousand. (Test: `rejects non-finite or out-of-range policy basis points`)
- **version and limit validation**: The version is nonblank and the per-family limit is a positive integer. (Test: `rejects zero or non-integer family limits and blank versions`)
- **shipped policy immutability**: One caller cannot mutate the shipped policy or its nested lookup tables for later selections. (Test: `does not permit mutation of the shipped policy`)

