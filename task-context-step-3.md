# Task Context: Task 3

Title: Enforce family bounds, feature closure, brief support, and reference lineage
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

- Modify: `src/engine/evidence/selectEvidence.ts` (candidate ranking, dependency fixed point, brief evaluation, reference union)
- Modify: `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts` (only builders needed for multi-item lineage cases)
- Create: `src/engine/evidence/__tests__/selectEvidence.lineage.test.ts`

**Behavioral invariants to write as tests first:**

- `ranks each non-brief family by every documented tie-break and excludes overflow as FAMILY_SELECTION_LIMIT`: compare score descending, bundle `asOf` descending, item `observedAt` descending with null last, publisher/source/local ID/hash ascending.
- `excludes feature dependants to a fixed point and never backfills capped slots`: if A depends on excluded B and C depends on A, B is terminal first, then A and C become `FEATURE_DEPENDENCY_EXCLUDED`; a rank-17 candidate does not replace them.
- `keeps source-reference lineage valid when feature lineage resolves directly to a reference`: local lineage IDs are resolved within the same qualified bundle only.
- `keeps duplicate local evidence and reference IDs distinct across bundle hashes`: maps and decision joins always use qualified identity, never raw local ID globally.
- `records RESEARCH_BRIEF_UNAVAILABLE for a null brief`: the synthetic unavailable decision is terminal and no brief is selected.
- `selects a fully supported brief at the minimum of assessment and cited-average score`: cited average is floor(sum/count), brief score is `min(overallConfidenceBps, average)`, and reference lineage is the cited-item union.
- `excludes a brief when any cited item was rejected capped or dependency-excluded`: terminal reason is `BRIEF_REFERENCES_EXCLUDED_EVIDENCE` with canonically ordered excluded IDs; no partial brief support is allowed.
- `excludes an under-threshold otherwise-supported brief with its computed score`: the common minimum threshold applies after support resolution.
- `marks references selected lineage audit only or both and preserves originating bundle identity`: the union includes references reached from selected items and excluded decisions, with deterministic role flags/order.

- [ ] **Step 1: Write the failing cap/lineage/brief/reference tests**

  Build small fixtures for each state transition. Use a test-only policy with cap `1` to prove ranking without creating 17 claims. For fixed-point closure, explicitly assert the terminal reason and dependency list for each feature and assert no duplicate decision IDs. For references, include the same `referenceId` under two evidence hashes and assert two qualified output entries.

- [ ] **Step 2: Run the focused lineage tests and observe the missing behavior**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.lineage.test.ts`

  Expected: FAIL on cap ordering, dependency closure, brief, and/or reference-union assertions.

- [ ] **Step 3: Implement preliminary family decisions and monotonic dependency closure**

  Group only preliminarily eligible candidates by their declared family. Sort a copied array with the full comparator, mark the first `maxSelectedPerFamily` as preliminary inclusion, and terminally exclude the rest. Then repeatedly scan deterministic features in canonical qualified-ID order until a pass makes no changes; transition a preliminary feature to terminal exclusion when any same-bundle feature dependency is terminally excluded. Source-reference IDs satisfy lineage but are not feature dependencies. Never transition an excluded decision back to included and never refill a family slot.

- [ ] **Step 4: Evaluate briefs after non-brief decisions are terminal**

  Resolve every `sourceEvidenceId` against same-bundle feature/claim identities. If any does not have a terminal included decision, exclude the brief and list those local IDs in explicit string order. Otherwise calculate the floor average exactly with integer sum/division, cap it by publisher overall confidence, apply the common threshold, and inherit the deterministic union of cited selected-item references. A brief does not contribute independent facts or references.

- [ ] **Step 5: Build the qualified source-reference union**

  Resolve every referenced local ID within its bundle. Emit one entry per `<evidenceHash>/<referenceId>` with origin metadata and booleans/roles for selected lineage and audit-only use. A reference reached by both selected and excluded decisions reports both; unreferenced bundle references do not appear. Sort by bundle/source identity and local reference ID with explicit comparators.

- [ ] **Step 6: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.lineage.test.ts`

  Expected: PASS with all nine lineage invariants. Earlier scoring behavior is covered again by the dedicated validation phase.

  Run: `pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.lineage.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate must pass.

- [ ] **Step 7: Commit the terminal-decision pipeline**

  ```bash
  git add src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.lineage.test.ts
  git commit -m "m60: preserve evidence selection lineage"
  ```

## Repository Targets

### Expected Files
- src/engine/evidence/selectEvidence.ts
- src/engine/evidence/__tests__/evidenceSelectionFixtures.ts
- src/engine/evidence/__tests__/selectEvidence.lineage.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.lineage.test.ts
pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.lineage.test.ts --max-warnings 0
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **bounded deterministic ranking**: Each non-brief family applies all documented tie-breaks and terminally excludes overflow without relying on discovery order. (Test: `ranks each non-brief family by every documented tie-break and excludes overflow as FAMILY_SELECTION_LIMIT`)
- **fixed-point dependency closure**: Excluded feature dependencies propagate monotonically through dependants and no vacated cap slot is backfilled. (Test: `excludes feature dependants to a fixed point and never backfills capped slots`)
- **reference lineage satisfaction**: A same-bundle source-reference lineage ID is valid input lineage and is not mistaken for an excluded feature dependency. (Test: `keeps source-reference lineage valid when feature lineage resolves directly to a reference`)
- **bundle-qualified local identity**: Repeated local evidence and reference IDs under different evidence hashes remain separate candidates and lineage entries. (Test: `keeps duplicate local evidence and reference IDs distinct across bundle hashes`)
- **null brief decision**: A missing brief produces one terminal unavailable decision and no selected brief. (Test: `records RESEARCH_BRIEF_UNAVAILABLE for a null brief`)
- **supported brief ceiling**: A fully supported brief scores at the lower of publisher overall confidence and the floored average score of cited selected items. (Test: `selects a fully supported brief at the minimum of assessment and cited-average score`)
- **brief citation closure**: Any rejected, capped, or dependency-excluded citation terminally excludes the entire brief with ordered missing support IDs. (Test: `excludes a brief when any cited item was rejected capped or dependency-excluded`)
- **brief threshold**: A supported brief must still meet the common effective-score threshold and retains its computed score when excluded. (Test: `excludes an under-threshold otherwise-supported brief with its computed score`)
- **complete source-reference roles**: Qualified source references report selected lineage, audit-only lineage, or both and retain bundle origin in stable order. (Test: `marks references selected lineage audit only or both and preserves originating bundle identity`)

