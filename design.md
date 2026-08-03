# Design Document: Fix deterministicStatus coverage check

## The Problem Being Solved and Why It Matters

`selectEvidence.ts` attempts to determine the coverage status of deterministic features to emit warnings (e.g. `MISSING` or `REJECTED`). It does this by checking `candidatesByFamily.get("deterministic")`. However, deterministic candidates are bucketed in `candidatesByFamily` using their granular real `family` values (e.g., `position_state`, `price_quality`, etc.), not the literal string `"deterministic"`.

Thus, the lookup always returns `undefined`, treating deterministic evidence as unconditionally `"MISSING"`. This creates misleading warning messages (`EVIDENCE_MISSING_FAMILY: deterministic`) in live output and downstream consumers, falsely implying data was omitted even when it was actively selected and used.

## Key Design Decisions and Trade-offs Considered

1. **Change the key in `candidatesByFamily`:** We could group deterministic features under `"deterministic"` in `candidatesByFamily`. _Trade-off:_ This discards the granular family bucketing which might be useful elsewhere, or requires creating a secondary artificial entry for the same candidate.
2. **Scan `allRegisteredCandidates`:** We could iterate through the map of `allRegisteredCandidates` to check if any have `kind === "deterministic_feature"`. _Trade-off:_ This requires an `O(N)` iteration for something that can be tracked in `O(1)`.
3. **Add a registration-time counter (Chosen):** Introduce a counter (e.g., `registeredDeterministicCount`) that increments directly within `registerCandidate` or immediately prior, specific to deterministic features. _Rationale:_ This provides exactly the information needed (were any deterministic features ever registered as candidates?) efficiently, while mirroring the existing `selectedDeterministic.length` structure.

## Proposed Approach with Rationale

1. Add a `registeredDeterministicCount` variable initialized to `0` alongside the other trackers.
2. Modify `registerCandidate()` (or the call sites inside `for (const record of sortedRecords)`) to increment `registeredDeterministicCount` when a candidate is a `deterministic_feature`.
3. Update the derivation logic around line 1260 to use this counter instead of `candidatesByFamily`:
   ```ts
   let deterministicStatus: "MISSING" | "REJECTED" | "AVAILABLE" = "AVAILABLE";
   if (registeredDeterministicCount === 0) {
     deterministicStatus = "MISSING";
   } else if (selectedDeterministic.length === 0) {
     deterministicStatus = "REJECTED";
   }
   ```
   _Rationale:_ This guarantees we accurately distinguish between truly missing inputs (never registered) versus rejected inputs (registered but fell below a threshold or excluded), directly solving the bug.

## Assumptions Made

1. **Mode Derivation:** The calculated `mode` (`FULL` | `PARTIAL` | `DEGRADED_NO_RESEARCH`) currently only checks contextual families and research briefs, entirely ignoring `deterministicStatus`. We assume this is intentional and will not alter the `mode` calculation to include `deterministicStatus`.
2. **Registration Semantics:** A candidate is only considered "registered" if it actually passes fundamental lifecycle/scope exclusions. If all bundles containing deterministic features were expired or mismatched scopes, the features are correctly classified as `MISSING` (not `REJECTED`), which aligns with how contextual claims are currently treated.
3. **Acceptance Criteria "Live-verified":** The issue implies manual operator testing for live insights. This design covers only the code modifications and deterministic unit/regression tests.

## What is in scope and what is explicitly out of scope

**In Scope:**

- Fixing `deterministicStatus` derivation in `selectEvidence.ts`.
- Introducing `registeredDeterministicCount` (or equivalent registration check).
- Adding unit/regression tests to cover the "always MISSING" regression and the proper "REJECTED" and "AVAILABLE" cases.

**Out of Scope:**

- Changes to `mode` calculation logic.
- Changes to other families (contextual/research).
- Modifying how deterministic features are fundamentally scored or filtered.

## Risks or Concerns Identified from Code Analysis

- Consumers parsing warnings might have hardcoded logic expecting the `missing_family` warning for deterministic data (since it's always been there). Fixing this will suppress that warning in healthy runs, meaning consumers expecting it will see it disappear.
- While tests ensure the code behavior is correct, we need to ensure the test snapshot diff correctly reflects this change, as the system utilizes snapshot tests for determinism verification. The fix will change the snapshot outputs for cases where deterministic data is used, requiring snapshots to be updated.
