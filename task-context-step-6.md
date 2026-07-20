# Task Context: Task 6

Title: Orchestrate synthesis with one clock instant and canonical fingerprints
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-61
Repository: opsclawd/regime-engine
Branch: ai/issue-61
Start Commit: 8eb83b2403a525df9fbb640f75379bc56dc7bc3c

## Task Requirements

**Files:**

- Create: `src/application/use-cases/policyInsightFingerprints.ts`
- Create: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Create: `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- Modify: `src/application/use-cases/getCurrentRegimeUseCase.ts`
- Modify: `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts`
- Modify: `src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

**Invariants implemented first:**

- `one synthesis instant is shared by every time-sensitive collaborator`
- `pair scope selection time and position plan hash mismatches persist nothing`
- `exact replay returns the stored canonical winner without reducing again`
- `meaningful input or ruleset changes produce distinct history`
- `runtime contract rejection persists nothing`

- [ ] **Step 1: Write failing orchestration tests**

  Use fakes/spies to prove the clock is called once; the same instant reaches the regime read, selector, position freshness check, output generation, and persisted metadata. Reject pair/scope mismatch, selection-time mismatch, stale supplied position, unverified plan hash, plan/position identity mismatch, and #63 parser failure before insert. Prove replay short-circuits and changed market/position/selection/scope/ruleset changes the input hash.

- [ ] **Step 2: Confirm RED**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Expected: FAIL because explicit shared instants, fingerprints, and synthesis orchestration are absent.

- [ ] **Step 3: Make existing reads accept an explicit captured instant**

  Change the exported call surfaces without adding a second clock:

  ```ts
  export type GetCurrentRegimeUseCase = (
    query: RegimeCurrentQuery,
    observedAtUnixMs?: number
  ) => Promise<RegimeCurrentResponse>;

  export type SelectEvidenceForSynthesisUseCase = (input: {
    readonly scope: Scope;
    readonly selectedAtUnixMs?: number;
  }) => Promise<SelectedEvidenceSummary>;
  ```

  HTTP callers may omit the value and preserve existing behavior; synthesis supplies it. Validate supplied instants as non-negative finite integers. Do not call the dependency clock when an explicit instant is present.

- [ ] **Step 4: Implement canonical fingerprints and orchestration**

  Export `createSynthesizePolicyInsightUseCase(deps)` and `SynthesizePolicyInsightUseCase`. Capture `synthesisAtUnixMs` once; load/verify the canonical market snapshot, exact evidence scope, and optional position/plan; canonicalize and SHA-256 the market projection, position/plan or `NONE`, and full selection; then hash ruleset+pair+scope+component hashes. Exclude only documented presentation ages, never identities, decisions, freshness class/boundaries, policy versions, or lineage.

  On repository hit, return the stored canonical output. On miss, reduce, validate with #63, canonicalize/hash the output, and call `insertOrGet`. Derive `insightId` using #63's identity format from `synthesisInputHash`. Map transient evidence/insight persistence failures explicitly and never return an unpersisted output.

- [ ] **Step 5: Verify orchestration and changed signatures**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Run: `pnpm exec eslint src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/getCurrentRegimeUseCase.ts src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts`

  Expected: all mismatch paths persist zero rows, exact replay returns one ID, and all time assertions use one captured value.

- [ ] **Step 6: Commit the task**

  Run: `git add src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/getCurrentRegimeUseCase.ts src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts && git commit -m "m61: orchestrate canonical policy synthesis"`

## Repository Targets

### Expected Files
- src/application/use-cases/policyInsightFingerprints.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts
- src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts
- src/application/use-cases/getCurrentRegimeUseCase.ts
- src/application/use-cases/selectEvidenceForSynthesisUseCase.ts
- src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts
- src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts
pnpm exec eslint src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/getCurrentRegimeUseCase.ts src/application/use-cases/selectEvidenceForSynthesisUseCase.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **single captured time**: The clock is read once and the same instant drives market, selection, freshness, generation, and persistence. (Test: `one synthesis instant is shared by every time-sensitive collaborator`)
- **link mismatch fails before persistence**: Pair, scope, selection-time, position freshness, plan hash, or position identity mismatches persist no output. (Test: `pair scope selection time and position plan hash mismatches persist nothing`)
- **replay short circuit**: An exact repository hit returns the canonical stored winner without invoking the reducer or inserting. (Test: `exact replay returns the stored canonical winner without reducing again`)
- **semantic changes alter identity**: Scope, market, position-plan, selection, and ruleset changes each alter the synthesis input hash. (Test: `meaningful input or ruleset changes produce distinct history`)
- **contract validation before insert**: A reducer result rejected by the canonical #63 parser is never persisted. (Test: `runtime contract rejection persists nothing`)

