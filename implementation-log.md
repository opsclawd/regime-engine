# Task 5 Implementation Log

## Overview
Implemented Task 5: "Add the repository-backed selection use case".

## Changes
- **selectEvidenceForSynthesisUseCase.ts**:
  - Implemented the repository-backed selection use case.
  - Set up dependencies signature accepting repository, clock, and optional selector/policy.
  - Orchesrated a single clock read (`nowUnixMs()`) followed by a single read (`getLatest`) to read all current sources for the exact input scope on the "SOL/USDC" pair.
  - Injected the selected evidence selector (`selectEvidence`) and policy (`EVIDENCE_SELECTION_POLICY_V1`) as defaults.
- **selectEvidenceForSynthesisUseCase.test.ts**:
  - Implemented TDD-style unit tests verifying all five behavioral invariants:
    1. `captures the clock once and reads all current sources for the exact scope`
    2. `passes the same records instant scope and configured policy to the selector`
    3. `returns degraded success when the repository returns no records`
    4. `propagates EvidenceStoreUnavailableError unchanged without retry`
    5. `does not invoke history writes candles regime plan ledger or HTTP dependencies`

## Verification
- Running `pnpm exec vitest run src/application/use-cases/__tests__/selectEvidenceForSynthesisUseCase.test.ts` passes with all tests green.
- Typechecking passes without error: `pnpm run typecheck`
- Linter passes with zero warnings: `pnpm run lint`
