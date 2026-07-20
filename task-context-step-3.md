# Task Context: Task 3

Title: Add monotone evidence refinement and deterministic reasoning
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

- Create: `src/engine/policy/reasoning.ts`
- Modify: `src/engine/policy/synthesizePolicyInsight.ts`
- Modify: `src/engine/policy/__tests__/policyFixtures.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

**Invariants implemented first:**

- `lower-precedence evidence can tighten but never relax locked policy fields`
- `no evidence remains degraded rather than a successful zero signal`
- `expired and unknown evidence cannot affect policy`
- `contextual prose and research briefs never create actions or numerical levels`
- `fixed input produces byte-identical canonical insight output`

- [ ] **Step 1: Write failing evidence and determinism tests**

  Cover FULL/PARTIAL/DEGRADED selection, stale selected evidence, expired exclusions, missing families, conflicts, missing/rejected brief, allowlisted deterministic features, mismatched calculator/type/unit, support/resistance sorting/deduplication/bounds, and no structured levels. Add calm CHOP, upward, downward, stressed/high-volatility, sparse-evidence, and poor-price-quality fixtures. Snapshot canonical JSON twice for the same fixed envelope.

- [ ] **Step 2: Confirm RED**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

  Expected: FAIL because evidence stages 5-7 and reasoning templates are absent.

- [ ] **Step 3: Implement bounded evidence interpretation**

  Match deterministic features on the full binding tuple and allow only configured tightening. Aggregate selected contextual directions and #60 conflict totals; conflict can increase risk or reduce confidence but cannot produce a directional upgrade. Treat the selected research brief as lineage/explanation only. Extract prices only from allowlisted numeric support/resistance features with the exact unit; never parse claim or brief text.

- [ ] **Step 4: Implement fixed reasoning and warning templates**

  Export deterministic rendering functions:

  ```ts
  export function renderPolicyReasoning(input: {
    readonly orderedReasonCodes: readonly string[];
    readonly boundedIdentifiers: readonly string[];
  }): readonly string[];

  export function renderPolicyWarnings(input: {
    readonly selection: SelectedEvidenceSummary;
    readonly derivedWarnings: readonly string[];
  }): readonly string[];
  ```

  Sort reason codes by precedence then lexicographically, map #60 warnings without losing original lineage, cap all strings/arrays to #63 limits, and include `ADVISORY_ONLY`/no-execution authority. Do not copy arbitrary prose into machine codes or numeric fields.

- [ ] **Step 5: Verify evidence behavior and determinism**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

  Run: `pnpm exec eslint src/engine/policy/reasoning.ts src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`

  Expected: every degraded case remains explicit, every monotone assertion passes, and repeated canonical output is byte-identical.

- [ ] **Step 6: Commit the task**

  Run: `git add src/engine/policy/reasoning.ts src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts && git commit -m "m61: refine policy with selected evidence"`

## Repository Targets

### Expected Files
- src/engine/policy/reasoning.ts
- src/engine/policy/synthesizePolicyInsight.ts
- src/engine/policy/__tests__/policyFixtures.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts
pnpm exec eslint src/engine/policy/reasoning.ts src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **monotone evidence refinement**: Selected evidence may increase caution but cannot relax a field locked by a higher precedence stage. (Test: `lower-precedence evidence can tighten but never relax locked policy fields`)
- **explicit no-evidence degradation**: An empty deterministic selection remains degraded with empty lineage and warnings rather than becoming a numeric zero signal. (Test: `no evidence remains degraded rather than a successful zero signal`)
- **excluded evidence is audit only**: Expired candidates and unknown or mismatched deterministic bindings cannot change output policy. (Test: `expired and unknown evidence cannot affect policy`)
- **prose has no execution or metric authority**: Contextual claims and briefs can add bounded explanation only and cannot create actions or numeric support/resistance values. (Test: `contextual prose and research briefs never create actions or numerical levels`)
- **byte deterministic output**: A fixed envelope and ruleset produce byte-identical canonical PolicyInsight output. (Test: `fixed input produces byte-identical canonical insight output`)

