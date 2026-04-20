---
date: 2026-04-17
topic: clmm-regime-engine-integration-sprint
---

# CLMM Regime Engine Integration Sprint Requirements

## Problem Frame

CLMM can already execute exits, and this repo can already accept execution results and produce ledger-backed reports. The missing capability is an integrated operating loop: analyst support/resistance levels are not stored durably, CLMM execution outcomes do not consistently flow back into the regime engine's truth ledger, and the two services are not yet deployed together in a way that supports a live low-capital run.

This sprint is intended to close those integration gaps and make a single live $100 SOL/USDC position operational without expanding the regime engine into an execution system or turning the sprint into a broader platform redesign.

## Requirements

**S/R Ingestion And Availability**

- R1. The system must persist daily support/resistance levels derived from OpenClaw briefs in the regime engine so they remain queryable over time by symbol and source.
- R2. The persisted level set for a symbol/source pair must expose one current active set while preserving prior sets as historical records rather than overwriting history in place.
- R3. The system must provide a read path for the current active level set for `SOL/USDC` from source `mco` so CLMM can display it to the operator.
- R4. The levels read experience in CLMM must be read-only, show freshness information, and fail safely with a clear empty-state message when no current levels exist.

**Execution Feedback Loop**

- R5. CLMM must send an execution-result event to the regime engine after an exit has completed and CLMM has recorded its own execution record.
- R6. Execution-result delivery must be best-effort analytics plumbing: a failure to notify the regime engine must never block, fail, or roll back CLMM's execution path.
- R7. The execution-result data sent from CLMM must be sufficient for the regime engine to build a truthful ledger record of what happened, including breach direction, execution timing, position context, and transaction reference.
- R8. Replaying the same execution-result event must not create duplicate truth-ledger records.

**Deployment And Operability**

- R9. CLMM and the regime engine must be deployed into the same Railway project with working service-to-service connectivity suitable for CLMM to reach the regime engine at runtime.
- R10. The regime engine must expose only the minimum externally reachable capabilities needed for this sprint: health, S/R ingestion, current S/R reads, and weekly report reads.
- R11. Any externally writable ingestion path introduced by this sprint must be protected by a shared-secret mechanism appropriate for a low-scale internal tool deployment.

**Validation And Live Readiness**

- R12. The integrated system must support a manual end-to-end verification flow covering S/R ingestion, current-level retrieval, breach handling, execution-result delivery, and duplicate-event behavior.
- R13. Sprint success must be judged against a live-readiness outcome: one $100 SOL/USDC position can run on mainnet with one wallet once the integration flow is verified healthy.

## Success Criteria

- Support/resistance levels from OpenClaw are durably stored and a current set can be retrieved for operator use.
- CLMM exits produce execution-result records in the regime engine's truth ledger without making the execution path fragile.
- Both services run together on Railway with confirmed connectivity between them.
- A single manual integrated breach exercise proves the full path from ingestion through ledger persistence.
- The system is ready for a constrained live deployment of one $100 SOL/USDC position, with no requirement to expand beyond that capital level in this sprint.

## Scope Boundaries

- The regime engine remains analytics-only in this sprint; CLMM does not use `POST /v1/plan` as an execution input.
- No runtime regime filter is introduced to alter CLMM exit behavior; breach direction alone determines the exit direction.
- No dashboard, charting, historical S/R comparison UI, or report-tuning work is included.
- No multi-analyst support is included; the only source in scope is `mco`.
- No whipsaw filtering, confidence weighting, level-expiry policy, monitoring stack, alerting stack, or kill-switch infrastructure is included.
- No shared library is extracted between repositories; integration remains HTTP-based.
- No infrastructure migration beyond Railway is included.
- No capital ramp beyond $100 is included.

## Key Decisions

- Analytics boundary is preserved: the regime engine records plans, execution results, and reports, but does not execute trades.
- Historical S/R records are preserved: each new brief replaces the current active set for read purposes without destroying prior level sets.
- CLMM is the source of execution truth for what was executed, while the regime engine is the authority for the ledger of what was planned and reported.
- Execution-result posting is non-blocking: missing analytics data is preferable to interfering with a real on-chain exit.
- The sprint is intentionally narrow: the goal is live operability with one small position, not a generalized multi-service trading platform.

## Dependencies / Assumptions

- OpenClaw can produce or be made to produce structured S/R brief data that can be mapped into a canonical ingest payload.
- CLMM can emit a stable execution correlation identifier that is safe to use for duplicate suppression.
- Railway deployment can provide both public access for the required read/write endpoints and service-to-service connectivity between CLMM and the regime engine.
- This repo's existing execution-result endpoint and ledger flow remain the canonical contract on the regime-engine side unless planning verifies a minimal required extension. As verified in `src/contract/v1/types.ts` and `src/http/handlers/executionResult.ts`, that contract is currently plan-linked rather than a generic breach-event payload.

## Outstanding Questions

### Resolve Before Planning

None.

### Deferred to Planning

- [Affects R5, R7, R8][Technical] Decide whether CLMM should adapt to the existing plan-linked execution-result contract in this repo or whether this repo needs a minimal contract extension to support the intended breach-context fields.
- [Affects R9][Technical] Choose the concrete Railway networking and endpoint-protection approach if internal-network identification is ambiguous at deploy time.
- [Affects R12][Technical] Decide the cheapest credible way to run the end-to-end verification flow without accidentally requiring real funded liquidity during the test setup.

## Visual Aid

```text
OpenClaw brief
    |
    v
Regime engine ingests and stores current + historical S/R levels
    |
    +--> CLMM reads current levels for operator-facing display

CLMM detects and executes breach exit
    |
    v
CLMM records internal execution result
    |
    v
CLMM sends execution-result event to regime engine
    |
    v
Regime engine appends truth-ledger record and supports later reporting
```

## Next Steps

-> `/ce:plan` for structured implementation planning
