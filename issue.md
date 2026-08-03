# deterministicStatus coverage check always reports MISSING due to family-key mismatch in selectEvidence.ts

## Summary

`selectEvidence.ts`'s deterministic-family coverage check is structurally broken and unconditionally reports `deterministicStatus: "MISSING"` on every synthesis run, regardless of whether deterministic evidence was actually collected, transmitted, and selected. This produces the misleading `EVIDENCE_MISSING_FAMILY: "Family deterministic is missing from selected evidence"` reason code seen in real, live `PolicyInsight` output even when deterministic evidence genuinely was used.

## Root cause

Two separate, inconsistently-keyed bookkeeping structures exist for deterministic-feature candidates:

1. `candidatesByFamily` (`selectEvidence.ts:316-322`) groups every candidate by its **real** `family` value — for deterministic features this is `position_state`/`price_quality`/`market_state`/`liquidity`/`risk` (set upstream in `sol-usdc-clmm-intelligence`'s `mapFeatureKindToFamily`), never the literal string `"deterministic"`.
2. `countForCoverage` (`selectEvidence.ts:1118-1124`) correctly special-cases `c.kind === "deterministic_feature"` and buckets it under the literal key `"deterministic"` for a *different* counter, independent of `candidatesByFamily`.

The coverage-status derivation at `selectEvidence.ts:1259-1264` queries the wrong structure:
```ts
let deterministicStatus: "MISSING" | "REJECTED" | "AVAILABLE" = "AVAILABLE";
const detCandidates = candidatesByFamily.get("deterministic") || [];
if (detCandidates.length === 0) {
  deterministicStatus = "MISSING";
}
```
`candidatesByFamily.get("deterministic")` is always `undefined` → always `[]` → `deterministicStatus` is unconditionally `"MISSING"`, even when `selectedDeterministic` (populated correctly, `selectEvidence.ts:1127-1134`) is non-empty and deterministic features were genuinely used in scoring elsewhere in this same function.

## Impact

- Every `PolicyInsight` this repo has ever produced has carried a spurious `EVIDENCE_MISSING_FAMILY: deterministic` warning, misleading anyone reading the output (including downstream consumers like `clmm-v2`'s UI) into thinking deterministic price/position/market data was unavailable, when it was actually collected, transmitted, and used.
- This makes the completeness/mode logic (`FULL`/`PARTIAL`/`DEGRADED_NO_RESEARCH`, if `deterministicStatus` feeds into it) potentially incorrect too — worth checking whether `deterministicStatus` gates anything beyond the reason-code text.

## Fix

Replace the broken lookup with a check against `selectedDeterministic`/`countForCoverage["deterministic"]` (the correctly-keyed structures), e.g.:
```ts
let deterministicStatus: "MISSING" | "REJECTED" | "AVAILABLE" = "AVAILABLE";
if (countForCoverage["deterministic"] === 0 && selectedDeterministic.length === 0) {
  // distinguish "no deterministic candidates were ever registered" (MISSING)
  // from "candidates existed but none survived selection" (REJECTED)
}
```
Needs a registration-time counter of *all* deterministic-feature candidates (not just selected ones) to correctly distinguish `MISSING` from `REJECTED`, since `candidatesByFamily` can't be reused directly.

## Acceptance criteria

- [ ] `deterministicStatus` correctly reports `AVAILABLE` when deterministic evidence was collected and selected (confirmed via a real live synthesis, not just a unit fixture).
- [ ] Still correctly reports `MISSING`/`REJECTED` when deterministic evidence genuinely wasn't available/selected (add a regression test for this negative case too).
- [ ] Regression test added asserting the previous always-MISSING behavior doesn't regress.
- [ ] Live-verified: a real `PolicyInsight` no longer carries `EVIDENCE_MISSING_FAMILY: deterministic` when deterministic data was actually used.

