# Regime Engine + CHOP CLMM Carry — Status & Audit Log

## Current status

- Milestone: M0 (not started)
- Mode: Phase 1 — alert + one-click execution (user signs)

## Repo assumptions

- Monorepo with `pnpm` workspace (adjust if different)
- Existing Solana CLMM stop-loss scaffolding and receipt program may already exist
- Target pair: SOL/USDC only

## How to run (placeholder; fill as milestones land)

### Quality

- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`

### Harness

- TBD in M0 (will produce `artifacts/plan.json`)

### Ledger + reports

- TBD in M1/M10

## Decisions (locked)

- Strategy is a **portfolio regime engine**: UP/DOWN/CHOP
- CLMM is a **CHOP-only carry tactic** (never opened in UP/DOWN)
- Partial shifts and volatility targeting are required; no default 0/100 flips
- Hysteresis + churn budgets are mandatory
- Execution is checkpointed, idempotent, receipt-guarded
- Truth ledger is first-class and append-only

## Known risks

- Regime systems can whipsaw; hysteresis and churn budgets must be strict
- Execution quality under congestion is the main tail risk
- Fee “APR” signals are unstable; carry score must be gated and conservative

## Audit log

### YYYY-MM-DD

- (empty) — first long-horizon run not started yet

## Next steps

- Start M0: add/confirm quality commands and create a deterministic harness that outputs `artifacts/plan.json` from fixtures
