# Task Context: Task 2

Title: Implement exact bundle and item scoring with terminal decisions
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

- Create: `src/engine/evidence/selectEvidence.ts`
- Create: `src/engine/evidence/__tests__/evidenceSelectionFixtures.ts`
- Create: `src/engine/evidence/__tests__/selectEvidence.scoring.test.ts`

**Exported API surface:** Add `SelectEvidenceInput`, `SelectedEvidenceSummary` and its named nested result/decision/lineage types, and `selectEvidence`. Keep the selector input limited to records, one instant, one exact scope, and policy; do not accept market state, plan state, or guards.

**Behavioral invariants to write as tests first:**

- `selects fresh high-confidence features and claims with exact component scores`: exact formula uses confidence × source quality × provenance quality × minimum freshness divided by `10_000^3`, floors once with `bigint`, and returns a safe integer.
- `downweights a stale bundle once and emits STALE_EVIDENCE_DOWNWEIGHTED`: stale bundle and stale feature use `min(bundle,item)` rather than multiplying stale twice.
- `uses inclusive feature freshness and claim expiry boundaries`: equality is usable; strictly past feature freshness is stale and strictly past claim expiry is `CLAIM_EXPIRED`.
- `excludes expired bundles and records every contained candidate as BUNDLE_EXPIRED`: expired evidence never reaches scoring or inclusion.
- `excludes unavailable and invalid features with distinct terminal reasons`: unavailable and invalid candidates retain audit lineage but never score as selected.
- `applies exact-source overrides before the conservative default and honors zero as disabled`: source keys are publisher+source qualified; publisher assessment cannot promote either path.
- `applies calculator derived collected and human-authored provenance weights exactly`: deterministic features use calculator weight and each claim method uses its configured factor.
- `excludes scores below threshold while retaining score components`: equality with the threshold is eligible; only lower scores are excluded.
- `isolates scope and lifecycle metadata mismatches without corrupting valid peers`: mismatched records and their contents receive record mismatch reasons while valid records continue.
- `rejects invalid input before returning partial output`: non-finite/non-integer/negative `selectedAtUnixMs`, invalid policy, or an impossible final score throws synchronously from the pure call.

- [ ] **Step 1: Create contract-valid fixture builders and failing scoring tests**

  Builders must default to a fixed pair scope, source identity, canonical timestamps, at least one deterministic feature, at least one source reference, and internally consistent assessment/provenance. Expose overrides for source, lifecycle, feature/claim family, timestamps, confidence, provenance, brief, and references. Validate builder output with `parseEvidenceBundleV1` so tests cannot exercise impossible contract shapes accidentally.

  In the exact arithmetic test, use factors that expose premature division/float rounding and assert the formula through a helper equivalent to:

  ```ts
  const expected = Number(
    (BigInt(confidenceBps) * BigInt(sourceBps) * BigInt(provenanceBps) * BigInt(freshnessBps)) /
      10_000n ** 3n
  );
  ```

- [ ] **Step 2: Run the scoring test file and observe the missing selector failure**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.scoring.test.ts`

  Expected: FAIL because `selectEvidence` and result types do not exist.

- [ ] **Step 3: Define the result model and selection stages**

  Define qualified candidate identity as `<evidenceHash>/<kind>/<localId>` where kind is `deterministic_feature`, `contextual_claim`, or `research_brief`; use the literal local ID `<unavailable>` for a null brief decision. Each selected item and decision includes bundle hash/row/run/correlation/source identity, original item, raw confidence, source/provenance/freshness components, final score when calculable, source-reference IDs, status, and stable reasons.

  The top-level shape must contain exactly the advisory selection concerns:

  ```ts
  export interface SelectEvidenceInput {
    readonly records: readonly EvidenceBundleRecord[];
    readonly selectedAtUnixMs: number;
    readonly scope: Scope;
    readonly policy: EvidenceSelectionPolicy;
  }

  export interface SelectedEvidenceSummary {
    readonly selectionPolicyVersion: string;
    readonly selectedAtUnixMs: number;
    readonly pair: "SOL/USDC";
    readonly scope: Scope;
    readonly authority: "ADVISORY_ONLY";
    readonly mode: "FULL" | "PARTIAL" | "DEGRADED_NO_RESEARCH";
    readonly selected: {
      readonly deterministicFeatures: readonly SelectedDeterministicFeature[];
      readonly contextualEvidence: SelectedContextualFamilies;
      readonly researchBrief: SelectedResearchBrief | null;
    };
    readonly familyCoverage: FamilyCoverageSummary;
    readonly deterministicEvidenceCoverage: DeterministicCoverageSummary;
    readonly conflicts: readonly ConflictSummary[];
    readonly warnings: readonly SelectionWarning[];
    readonly sourceReferences: readonly SelectedSourceReference[];
    readonly bundles: readonly BundleSelectionLineage[];
    readonly decisions: readonly EvidenceSelectionDecision[];
  }
  ```

  Do not expose recommendation/action/allocation/CLMM/guard fields. Initialize summary fields through deterministic helper functions rather than mutable output shared between invocations.

- [ ] **Step 4: Implement exact lifecycle and score evaluation**

  Validate input first. Recompute lifecycle from bundle timestamps with `selectedAt <= freshUntil` → `FRESH`, else `selectedAt <= expiresAt` → `STALE`, else `EXPIRED`; reject record metadata disagreement instead of repairing it. Compare scope structurally through the existing deterministic `evidenceScopeKey` behavior (or an inner-layer equivalent that does not import the application port).

  Sort records explicitly by publisher, source ID, `asOf`, received time, row ID, then evidence hash using a comparator based on `<`, `>`, and numeric comparison (never locale-sensitive comparison). Resolve source quality by exact key then default. Evaluate bundle eligibility, feature status/freshness, claim expiry/provenance, and threshold. Use one `bigint` numerator and one denominator; assert the result lies in `[0, 10_000]` before converting to number.

- [ ] **Step 5: Run focused verification**

  Run: `pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.scoring.test.ts`

  Expected: PASS with all ten scoring/lifecycle invariants.

  Run: `pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.scoring.test.ts --max-warnings 0`

  Expected: PASS with zero warnings. The automatic workspace typecheck gate must also pass before commit.

- [ ] **Step 6: Commit the scoring kernel**

  ```bash
  git add src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.scoring.test.ts
  git commit -m "m60: score evidence candidates exactly"
  ```

## Repository Targets

### Expected Files
- src/engine/evidence/selectEvidence.ts
- src/engine/evidence/__tests__/evidenceSelectionFixtures.ts
- src/engine/evidence/__tests__/selectEvidence.scoring.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/evidence/__tests__/selectEvidence.scoring.test.ts
pnpm exec eslint src/engine/evidence/selectEvidence.ts src/engine/evidence/__tests__/evidenceSelectionFixtures.ts src/engine/evidence/__tests__/selectEvidence.scoring.test.ts --max-warnings 0
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **exact fresh scoring**: Fresh candidates use exact bigint multiplication and one floored division with all score components preserved. (Test: `selects fresh high-confidence features and claims with exact component scores`)
- **single stale penalty**: A stale bundle remains eligible at the stale factor and bundle/item staleness is combined with minimum rather than multiplied twice. (Test: `downweights a stale bundle once and emits STALE_EVIDENCE_DOWNWEIGHTED`)
- **inclusive item boundaries**: Feature freshness and claim expiry accept equality and change behavior only when the selection instant is strictly later. (Test: `uses inclusive feature freshness and claim expiry boundaries`)
- **expired bundle terminal exclusion**: An expired bundle and every candidate it contains are terminally excluded before scoring. (Test: `excludes expired bundles and records every contained candidate as BUNDLE_EXPIRED`)
- **feature status exclusions**: Unavailable and invalid deterministic features receive distinct audit reasons and are never selected. (Test: `excludes unavailable and invalid features with distinct terminal reasons`)
- **source policy precedence**: An exact qualified source override wins over default quality, zero disables the source, and publisher assessment never promotes it. (Test: `applies exact-source overrides before the conservative default and honors zero as disabled`)
- **provenance weighting**: Calculator, derived, collected, and human-authored candidates receive their exact configured provenance factors. (Test: `applies calculator derived collected and human-authored provenance weights exactly`)
- **threshold boundary**: A score equal to the minimum remains eligible while a lower score is excluded with components retained. (Test: `excludes scores below threshold while retaining score components`)
- **record mismatch isolation**: Scope or recomputed-lifecycle mismatch excludes only the bad record and does not corrupt valid peers. (Test: `isolates scope and lifecycle metadata mismatches without corrupting valid peers`)
- **fail-fast input validation**: Invalid time, policy, or internal score fails before any partial summary is returned. (Test: `rejects invalid input before returning partial output`)

