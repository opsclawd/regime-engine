# Regime Engine + CHOP-Only CLMM Carry (Solana SOL/USDC)

This repo builds a **portfolio regime engine** for SOL/USDC that aims to:

- be primarily **USDC** during sustained **downtrends** (risk-off),
- be primarily **SOL** during sustained **uptrends** (risk-on),
- and run **CLMM carry only during CHOP** (sideways markets) to harvest fees.

Phase 1 ships as **alert + one-click execution** (user signs). No unattended auto-trading.

---

## Why this exists

Most “LP stop-loss bots” fail because they:

- churn on fakeouts,
- execute poorly when volatility spikes,
- and confuse attractive fee APR with durable edge.

This system is built as:

1) a deterministic **strategy kernel** (pure functions, testable),
2) a checkpointed **execution engine** (idempotent, receipt-guarded),
3) an append-only **truth ledger** (PnL decomposition + audit),
4) a minimal **operator UX** (shadow → simulate → execute).

---

## Architecture overview

### Strategy layer (pure / testable)

Produces a `Plan` from inputs (candles, snapshot, state, config):

- Regime classifier: `UP | DOWN | CHOP` with hysteresis
- Volatility targeting + partial allocation policy
- Churn governor (budgets, cooldowns, stand-down)
- CLMM Carry gate:
  - **CHOP-only**
  - carry score threshold
  - liquidity/impact checks
- Deterministic reason codes for every decision

**No Solana/RPC calls are allowed inside the strategy layer.**

### Execution layer (adversarial reality)

Consumes the `Plan` and executes it safely:

- Plan preview + simulation
- One-click execution (user signs)
- Checkpointed executor (safe resume):
  - `PLAN_CREATED`
  - `CLOSE_CONFIRMED`
  - `SWAP_CONFIRMED`
  - `RECEIPT_CONFIRMED`
- Slippage caps, quote freshness, fee buffers, bounded retries
- Safe-mode refusal paths (explicit, logged)

### Truth ledger (append-only)

Every plan and execution outcome is recorded with:

- reasons, timestamps, regime state
- costs (tx fees, priority fees, slippage estimates)
- fees earned and PnL snapshots
- baseline comparisons:
  - SOL HODL
  - SOL DCA
  - USDC carry (APR model)

### Receipt program (idempotency / audit)

A one-time on-chain receipt prevents duplicate executions per epoch and provides an auditable proof of actions.

---

## Repo workflow (long-horizon)

This project is intended to be run as a long-horizon agent task with durable project memory files:

- `Prompt.md` — spec + constraints
- `Plan.md` — milestones + acceptance criteria + validations
- `Implement.md` — runbook for the agent loop
- `Documentation.md` — status + audit log + runbook

Agent loop:

1) implement milestone
2) run validations
3) fix failures
4) update `Documentation.md`
5) proceed

---

## Safety model (Phase 1)

- Monitoring + planning runs continuously (or on-demand).
- **No auto execution.**
- Operator clicks execute and signs with wallet.
- If conditions are unsafe (impact too high, quote stale, budgets exhausted), the system returns a refusal Plan and logs the reason.

---

## How to run

> Commands may vary depending on workspace layout. Adjust once M0 lands.

### Quality gates

```bash
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm -r build
```
