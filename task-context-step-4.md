# Task Context: Task 4

Title: Derive conflict, coverage, warnings, and canonical output
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

- Modify: `src/engine/evidence/selectEvidence.ts` (summaries and final canonical sorting only)
- Modify: `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts` (only conflict/permutation helpers)
- Create: `src/engine/evidence/__tests__/selectEvidence.summary.test.ts`

**Behavioral invariants to write as tests first:**

- `preserves bullish and bearish claims and computes conflict from effective scores`: both sides remain selected, direction totals use effective scores, consensus is `floor(abs(bullish-bearish)*10_000/(bullish+bearish))`, and the stable family conflict warning is emitted.
- `does not create conflict from neutral mixed or unknown claims`: those buckets are reported separately and do not enter directional consensus.
- `derives AVAILABLE CONFLICTED REJECTED and MISSING from terminal decisions`: publisher-declared coverage/quality is retained only in bundle lineage and never controls selected coverage.
- `returns FULL only for all five contextual families plus a brief with no conflict`: any missing/rejected/conflicted family or missing brief prevents full mode.
- `returns PARTIAL when at least one contextual claim or brief survives`: selected deterministic features alone do not cause partial mode.
- `returns DEGRADED_NO_RESEARCH for empty deterministic-only expired and fully-rejected inputs`: output is successful, advisory-only, and includes ordered missing/rejected/no-research warnings as applicable.
- `emits warnings in canonical family and code order without duplicates`: stale, conflict, missing/rejected, and no-research codes have stable ordering independent of discovery order.
- `produces deep-equal and byte-identical canonical JSON for every record permutation`: compare `toCanonicalJson` results for reversed and shuffled records/items.
- `gives every candidate exactly one terminal decision and every selected item one matching INCLUDED decision`: expired/rejected contents remain auditable and no terminal state is duplicated.
- `never exposes policy authority fields`: recursively assert the result has no keys named `action`, `allocation`, `allowClmm`, `guard`, or `override` and always has literal `ADVISORY_ONLY`.

- [ ] **Step 1: Write the failing summary and permutation tests**

  The conflict fixture must combine fresh and stale claims from different source IDs so totals prove weighting rather than claim counting. Cover every contextual family and every deterministic family in table-driven coverage checks. For permutations, permute records and reverse feature, claim, citation, warning, and reference arrays in cloned valid bundles, then compare both deep equality and `toCanonicalJson` bytes.

- [ ] **Step 2: Run the summary test file and observe the missing summary behavior**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.summary.test.ts`

  Expected: FAIL on conflict totals, mode/coverage, ordering, or decision-integrity assertions.

- [ ] **Step 3: Implement directional summaries and derived coverage**

  For contextual families in the fixed order `supportResistance`, `flows`, `derivatives`, `events`, `newsRegulatory`, sum selected score by all five direction buckets. Mark a family `CONFLICTED` iff both bullish and bearish are non-zero. For every family, derive `AVAILABLE`/`CONFLICTED` from selected items, `REJECTED` from candidates with none selected, and `MISSING` from no candidates. Derive deterministic family coverage separately and do not let it alter research mode.

- [ ] **Step 4: Derive mode and canonical warnings**

  Set `FULL` only when all contextual families are available, none is conflicted, and the brief is selected. Set `PARTIAL` when any contextual claim or brief is selected otherwise. Set `DEGRADED_NO_RESEARCH` when neither contextual claims nor brief survive. Produce stable missing/rejected/conflict/stale/no-research warnings from final state, deduplicate by code plus qualified subject, and sort with a constant family/code rank followed by explicit string keys.

- [ ] **Step 5: Canonically sort the complete result and assert integrity**

  Sort selected features/claims, bundles, decisions, conflicts, warnings, and references from copied arrays. Before returning, assert every candidate has one terminal decision, every selected qualified ID maps to exactly one `INCLUDED` decision, and every numeric score is a safe integer in range. Do not sort publisher-owned arrays inside the original item objects in place; clone and normalize them so inputs are never mutated.

- [ ] **Step 6: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.summary.test.ts`

  Expected: PASS with all ten summary/determinism invariants. The complete selector suite runs in the dedicated validation phase.

  Run: `pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.summary.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate must pass.

- [ ] **Step 7: Commit the deterministic summary behavior**

  ```bash
  git add src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.summary.test.ts
  git commit -m "m60: summarize selected evidence deterministically"
  ```

## Repository Targets

### Expected Files
- src/engine/evidence/selectEvidence.ts
- src/engine/evidence/__tests__/evidenceSelectionFixtures.ts
- src/engine/evidence/__tests__/selectEvidence.summary.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.summary.test.ts
pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.summary.test.ts --max-warnings 0
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **weighted directional conflict**: Bullish and bearish claims both survive, conflict totals use effective scores, and consensus uses the documented exact floor formula. (Test: `preserves bullish and bearish claims and computes conflict from effective scores`)
- **non-directional bucket isolation**: Neutral, mixed, and unknown weights are reported but cannot create directional conflict or inflate consensus. (Test: `does not create conflict from neutral mixed or unknown claims`)
- **terminal-decision coverage**: Available, conflicted, rejected, and missing coverage derives only from final candidate decisions, never publisher claims. (Test: `derives AVAILABLE CONFLICTED REJECTED and MISSING from terminal decisions`)
- **full research mode**: Full mode requires all five contextual families, a selected brief, and no conflicted family. (Test: `returns FULL only for all five contextual families plus a brief with no conflict`)
- **partial research mode**: Partial mode requires at least one selected contextual claim or brief when full mode is not satisfied. (Test: `returns PARTIAL when at least one contextual claim or brief survives`)
- **explicit no-research degradation**: Empty, deterministic-only, expired, and fully rejected research inputs succeed in advisory degraded mode with appropriate warnings. (Test: `returns DEGRADED_NO_RESEARCH for empty deterministic-only expired and fully-rejected inputs`)
- **canonical warning order**: Warning generation is deduplicated and sorted by fixed family/code order independent of discovery order. (Test: `emits warnings in canonical family and code order without duplicates`)
- **permutation-stable output**: Equivalent records and items in any input order produce deep-equal summaries and byte-identical canonical JSON. (Test: `produces deep-equal and byte-identical canonical JSON for every record permutation`)
- **decision integrity**: Every candidate has one terminal decision and every selected item maps to exactly one included decision. (Test: `gives every candidate exactly one terminal decision and every selected item one matching INCLUDED decision`)
- **advisory authority boundary**: Selection always reports advisory-only authority and contains no action, allocation, CLMM permission, guard, or override fields. (Test: `never exposes policy authority fields`)

