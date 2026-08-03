# Task Context: Task 1

Title: Correct deterministic coverage classification with focused regression tests
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-86
Repository: opsclawd/regime-engine
Branch: ai/issue-86
Start Commit: fbdec486b4e744aee5c65c378eed5a113f0da68c

## Task Requirements

**Files:**

- Create: `src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts`
- Modify: `src/engine/evidence/selectEvidence.ts` (candidate registration near `registerCandidate`, and deterministic coverage derivation near `deterministicStatus`)
- Read only: `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts`
- Read only: `src/engine/evidence/selectionPolicy.ts`
- Read only: `src/engine/evidence/__tests__/selectEvidence.summary.test.ts`

**Named invariant tests to write first:**

- `does not warn that deterministic evidence is missing when a registered feature is selected`
- `warns that deterministic evidence was rejected when registered features fail selection`
- `warns that deterministic evidence is missing when no feature is registered`

- [ ] **Step 1: Create the focused regression test file before changing selection logic**

Create `src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts` with three direct cases and a helper that filters only deterministic-family warnings, so unrelated missing contextual-family warnings cannot make assertions brittle:

```ts
import { describe, expect, it } from "vitest";
import { selectEvidence } from "../selectEvidence.js";
import { EVIDENCE_SELECTION_POLICY_V1 } from "../selectionPolicy.js";
import { buildEvidenceBundle, buildEvidenceRecord } from "./evidenceSelectionFixtures.js";

function selectWithThreshold(
  bundle: ReturnType<typeof buildEvidenceBundle>,
  minimumEffectiveScoreBps: number
) {
  return selectEvidence({
    records: [
      buildEvidenceRecord(bundle, {
        lifecycle: "FRESH",
        evidenceHash: "hash-deterministic-coverage"
      })
    ],
    selectedAtUnixMs: Date.parse(bundle.asOf),
    scope: { kind: "pair" },
    policy: {
      ...EVIDENCE_SELECTION_POLICY_V1,
      defaultSourceQualityBps: 10_000,
      minimumEffectiveScoreBps
    }
  });
}

function deterministicWarnings(result: ReturnType<typeof selectEvidence>) {
  return result.warnings.filter((warning) => warning.message.includes("deterministic"));
}

describe("deterministic evidence coverage status", () => {
  it("does not warn that deterministic evidence is missing when a registered feature is selected", () => {
    const result = selectWithThreshold(buildEvidenceBundle(), 1_000);

    expect(result.selected.deterministicFeatures).toHaveLength(1);
    expect(deterministicWarnings(result)).toEqual([]);
    expect(result.mode).toBe("DEGRADED_NO_RESEARCH");
  });

  it("warns that deterministic evidence was rejected when registered features fail selection", () => {
    const result = selectWithThreshold(buildEvidenceBundle(), 10_000);

    expect(result.selected.deterministicFeatures).toHaveLength(0);
    expect(deterministicWarnings(result)).toEqual([
      {
        code: "rejected_family",
        message: "Family deterministic has candidates but none were selected"
      }
    ]);
  });

  it("warns that deterministic evidence is missing when no feature is registered", () => {
    const result = selectWithThreshold(
      buildEvidenceBundle({ deterministicFeatures: [] }),
      1_000
    );

    expect(result.selected.deterministicFeatures).toHaveLength(0);
    expect(deterministicWarnings(result)).toEqual([
      {
        code: "missing_family",
        message: "Family deterministic is missing from selected evidence"
      }
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the regression is exposed**

Run:

```bash
pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts
```

Expected: FAIL before the implementation change. The AVAILABLE case receives the false deterministic `missing_family` warning, and the REJECTED case receives `missing_family` instead of `rejected_family`; the MISSING case should already pass.

- [ ] **Step 3: Count deterministic candidates at their single registration boundary**

In `src/engine/evidence/selectEvidence.ts`, initialize a local counter beside `candidatesByFamily`, and increment it inside `registerCandidate` before retaining the existing granular-family insertion:

```ts
  const candidatesByFamily = new Map<string, IntermediateCandidate[]>();
  let registeredDeterministicCount = 0;

  const registerCandidate = (c: IntermediateCandidate) => {
    if (c.kind === "deterministic_feature") {
      registeredDeterministicCount++;
    }
    if (!candidatesByFamily.has(c.family)) {
      candidatesByFamily.set(c.family, []);
    }
    candidatesByFamily.get(c.family)!.push(c);
  };
```

This placement deliberately counts candidates after the existing fundamental lifecycle, scope, availability, and validity exclusions, but before threshold, dependency, or cap decisions.

- [ ] **Step 4: Derive deterministic coverage from registration and terminal selection**

Replace only the broken literal-family lookup in `src/engine/evidence/selectEvidence.ts`; preserve the existing status union and downstream warning mapping:

```ts
  let deterministicStatus: "MISSING" | "REJECTED" | "AVAILABLE" = "AVAILABLE";
  if (registeredDeterministicCount === 0) {
    deterministicStatus = "MISSING";
  } else if (selectedDeterministic.length === 0) {
    deterministicStatus = "REJECTED";
  }
```

Do not change `countForCoverage`, contextual `familyStatus`, `mode`, warning text/order, or selected-output normalization.

- [ ] **Step 5: Verify the focused behavior and touched-file quality checks**

Run:

```bash
pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts
pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts --max-warnings 0
pnpm exec prettier --check src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts
```

Expected: all three named invariant tests pass, ESLint exits with zero warnings, and Prettier reports both files formatted.

- [ ] **Step 6: Review the scoped diff and commit the atomic fix**

Run:

```bash
git diff -- src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts
git add src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts
git commit -m "fix: classify deterministic evidence coverage correctly"
```

The diff must contain only the new focused tests, the internal counter, and the replacement of the broken lookup. No exported signature changes are expected.

**Task acceptance criteria**

- The three named invariant tests pass and directly distinguish AVAILABLE, REJECTED, and MISSING output.
- `candidatesByFamily` remains keyed by granular feature family; there is no synthetic `"deterministic"` entry.
- Existing warning strings and canonical sorting logic remain untouched.
- `mode` remains `DEGRADED_NO_RESEARCH` for the deterministic-only AVAILABLE fixture.
- After deployment to an environment with live evidence, an operator triggers one normal policy-insight synthesis whose selected evidence contains at least one deterministic feature and confirms the resulting `PolicyInsight.warnings` has no `EVIDENCE_MISSING_FAMILY` entry for deterministic data. Because deployment URL, credentials, and trigger mechanism are environment-specific and absent from this repository, this is a release acceptance check rather than a local shell command; lack of that access does not justify inventing a substitute endpoint.

**Tests to add or update**

- Add `src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts` with exactly the three named cases above.
- Do not update `src/engine/evidence/__tests__/selectEvidence.summary.test.ts` (683 lines, 11 test cases) or snapshot files; the new file complies with the oversized-test split rule and keeps the regression isolated.

**Dedicated validation phase (runs after all implementation tasks, not as a task)**

The implement loop automatically runs `pnpm -r typecheck` after the task. The repository quality gate then runs:

```bash
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build
```

Expected: strict TypeScript checks, contract checks plus the complete Vitest suite, zero-warning lint, and the production build all pass. Any failure outside the two changed files must be reported separately and must not be hidden by broad unrelated edits.

**Risk areas**

- The counter must increment only through `registerCandidate`; counting raw bundle features would incorrectly classify expired, mismatched, unavailable, or invalid inputs as REJECTED rather than MISSING.
- The counter must represent all registered deterministic candidates, not only selected candidates, or the REJECTED branch remains unreachable.
- Healthy warning output changes by removing a historically spurious warning. Downstream consumers must tolerate the warning disappearing; no schema change is involved.
- Moving candidates into a synthetic deterministic family would alter scoring caps and lineage behavior, so the granular family map must remain unchanged.
- The live acceptance check depends on operator environment access that is intentionally not encoded in repository scripts.

**Stop conditions**

- Abort implementation if current code no longer routes every eligible deterministic feature through the single `registerCandidate` helper; first revise this plan so registration counting cannot miss a path or double-count.
- Abort if contract/domain requirements establish that unavailable, invalid, expired, or scope-mismatched deterministic features must be classified as REJECTED rather than MISSING; that contradicts the approved design assumption and requires product clarification.
- Abort if satisfying the regression requires changing exported types, policy-insight schemas, warning codes/messages, mode semantics, adapters, or persistence. Those are explicit non-goals and require a new design decision.
- Abort before committing if the scoped diff includes unrelated user changes or if the focused tests demonstrate a pre-existing fixture/contract inconsistency that cannot be resolved within the two affected files.
- If the local quality gate passes but the live synthesis environment is unavailable, stop at code-complete status and hand the explicit operator verification criterion to the release owner; do not fabricate live verification.

## Repository Targets

### Expected Files
- src/engine/evidence/selectEvidence.ts
- src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts

### Reference Files
- src/engine/evidence/__tests__/evidenceSelectionFixtures.ts
- src/engine/evidence/selectionPolicy.ts
- src/engine/evidence/__tests__/selectEvidence.summary.test.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts"]
["pnpm","exec","eslint","src/engine/evidence/selectEvidence.ts","src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts","--max-warnings","0"]
["pnpm","exec","prettier","--check","src/engine/evidence/selectEvidence.ts","src/engine/evidence/__tests__/selectEvidence.deterministicCoverage.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **available deterministic evidence emits no deterministic coverage warning**: When an eligible deterministic feature is registered and survives selection, neither deterministic missing_family nor deterministic rejected_family is emitted, and deterministic-only input does not alter mode derivation. (Test: `does not warn that deterministic evidence is missing when a registered feature is selected`)
- **registered but unselected deterministic evidence is rejected**: When an eligible deterministic feature is registered but all deterministic candidates fail terminal selection, rejected_family is emitted for deterministic evidence and missing_family is not. (Test: `warns that deterministic evidence was rejected when registered features fail selection`)
- **unregistered deterministic evidence is missing**: When no deterministic feature reaches registration, missing_family is emitted for deterministic evidence and rejected_family is not. (Test: `warns that deterministic evidence is missing when no feature is registered`)

