# Solana Regime Engine + CHOP-Only CLMM Carry (One-Click Execution) — Long Horizon Spec


## Goal

Build a portfolio regime engine that targets being primarily **USDC in sustained downtrends**, primarily **SOL in sustained uptrends**, and uses **CLMM carry only during CHOP** to monetize sideways periods—shipped as **alert + one-click execution** (user signs), with a truth ledger and auditable receipts.

## Non-goals (for this long-horizon run)

- No unattended auto-trading / background daemons.
- No perps hedging, leverage, or liquidation risk systems.
- No discretionary signals (Elliott wave labeling) as an input to the automated decision engine.
- No multi-asset portfolio support beyond SOL/USDC.
- No “maximize APR” features; the objective is risk-adjusted repeatability.

## Hard constraints (must hold)

- **Determinism:** Strategy evaluation is a pure function. Same inputs → same Plan.
- **CHOP-only CLMM:** Never open CLMM positions unless regime == CHOP and carry score gate passes.
- **Hysteresis:** Regime transitions must not flip-flop (confirmations + separate enter/exit thresholds).
- **Churn limits:** Strict budgets (stopouts, redeploys, switches) + stand-down behavior.
- **Execution discipline:** Slippage caps, quote freshness limits, fee buffers, bounded retries, and safe-mode refusal.
- **Idempotency:** Checkpointed executor that can resume without double execution.
- **Auditability:** Every Plan and execution outcome must be written to an append-only truth ledger with reason codes.
- **Receipts:** On-chain receipt prevents duplicate execution per epoch (existing receipt program or minimal addition).

## Deliverables (must exist when finished)

### A) Strategy Kernel (pure / testable)

- `StrategyKernel.evaluate(input) -> Plan` (no Solana/RPC calls inside)
- Regime classifier: `UP | DOWN | CHOP` with hysteresis
- Volatility targeting + partial allocation policy (no 0/100 default flips)
- Churn governor: cooldowns, budgets, two-strike stand-down
- CLMM Carry gate: carry score + liquidity/impact gate + CHOP-only enforcement
- Full reason-code mapping

### B) Truth Ledger + Reporting

- Append-only ledger (JSONL or SQLite) capturing:
  - Plans, decisions, reasons
  - Execution checkpoints + outcomes
  - Fees, slippage estimates, priority fees, tx fees
  - Baselines: SOL HODL, SOL DCA, USDC carry (configurable APR)
- Weekly scorecard command that produces a report artifact from ledger only

### C) Execution Engine (Plan → Tx → Checkpointed Executor)

- “preview + simulate” path and “execute” path (user signs)
- Checkpoint states:
  - `PLAN_CREATED`
  - `CLOSE_CONFIRMED`
  - `SWAP_CONFIRMED`
  - `RECEIPT_CONFIRMED`
- Quote sanity checks, refusal paths, bounded retries, and safe-mode
- Receipt/idempotency check before building + before sending

### D) Operator UX

- Display:
  - current regime + why
  - target vs current exposure
  - CLMM enablement status + carry score + why disabled
  - churn budgets + cooldown timers
  - one-click “execute plan” with simulation-first preview
- Shadow mode (compute + simulate + ledger; no send)

## “Done when” (objective checks)

- Unit tests cover: regime transitions, hysteresis, churn governor, carry gate, sizing bounds
- A devnet harness can run end-to-end: snapshot → Plan → simulate → (optional) execute → receipt check → ledger writes
- All validations pass:
  - `pnpm -r lint`
  - `pnpm -r typecheck`
  - `pnpm -r test`
  - `pnpm -r build`
- `Documentation.md` includes a runbook + demo steps + current status + known issues

## Definitions (canonical)

- **Regime:**
  - UP: higher timeframe trend up + not in vol expansion shock
  - DOWN: higher timeframe trend down and/or vol expansion shock + risk-off
  - CHOP: low trend strength + compression / stable bounds
- **Carry Score:** mechanizable ratio of expected fee yield to realized volatility; gated by liquidity/impact constraints
- **Epoch:** use existing project’s canonical epoch definition for receipt uniqueness
