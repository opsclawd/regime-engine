# Long Horizon Plan — Regime Engine + CHOP CLMM Carry

## Operating rule (stop-and-fix)

After each milestone:

1) run its validation commands
2) if anything fails: fix immediately
3) update `Documentation.md`
4) only then proceed

## Global validation commands (run often)

- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`

## Milestones

### M0 — Baseline repo health + harness entrypoint

**Scope**

- Ensure single command set exists (or add) for lint/typecheck/test/build across workspace
- Add a deterministic harness entrypoint (local/devnet) that:
  - reads config
  - fetches required snapshot inputs (or uses fixtures)
  - runs StrategyKernel to emit a Plan JSON

**Acceptance**

- `pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm -r build` passes
- Running harness produces `artifacts/plan.json` deterministically on fixtures

**Validate**

- Global validation commands
- `pnpm --filter <harness-package> run harness:fixture` (or equivalent command created)

---

### M1 — Truth Ledger v1 (append-only) + baselines

**Scope**

- Ledger writer: JSONL (preferred for speed) or SQLite
- Schema events:
  - `plan_created`
  - `execution_checkpoint`
  - `execution_result`
  - `cost_observed` (tx fees, priority fees)
  - `pnl_snapshot` (fees, value, exposure)
- Baselines:
  - SOL HODL
  - SOL DCA (simple schedule model)
  - USDC carry (APR config)

**Acceptance**

- Any harness run appends ledger events
- A report command can read ledger and print a summary table

**Validate**

- Unit tests for ledger append + parse
- Snapshot tests for summary output

---

### M2 — StrategyKernel skeleton (pure, no Solana deps)

**Scope**

- `StrategyKernel.evaluate(input) -> Plan`
- Define typed `Input` + `Plan` contracts
- Reason codes enum
- Include “no trade” default behavior

**Acceptance**

- Unit tests run purely with candle fixtures
- Plan output is stable for same fixtures

**Validate**

- `pnpm -r test` + targeted tests

---

### M3 — Regime classifier (UP/DOWN/CHOP) + hysteresis

**Scope**

- Add signals:
  - trend proxy on higher timeframe (simple MA slope or regression slope)
  - realized vol + vol expansion ratio
  - chop compression proxy
- Hysteresis:
  - confirm N bars before switching
  - separate enter/exit thresholds
  - minimum dwell time per regime

**Acceptance**

- Whipsaw fixtures do not cause flip-flopping
- Every regime change yields explicit reason codes

**Validate**

- Fixture tests for each regime + whipsaw

---

### M4 — Churn governor (budgets + cooldown + stand-down)

**Scope**

- Track budgets in state:
  - max stopouts per window
  - max redeploys per day
  - max regime switches per window
  - cooldown after stopout
  - two-strike stand-down
- Enforce: Plan returns `STAND_DOWN` when budget exhausted

**Acceptance**

- Fakeout-heavy fixtures do not create endless close/swap/reopen loops
- Stand-down recovers only after re-qualification + cooldown

**Validate**

- Tests: budget exhaustion + recovery

---

### M5 — Vol targeting + partial allocation policy

**Scope**

- Exposure targets by regime:
  - UP: high SOL (but not necessarily 100%)
  - DOWN: low SOL (but not necessarily 0%)
  - CHOP: neutral-ish overlay; CLMM does work
- Volatility targeting to scale overlay exposure
- Daily turnover cap and max delta per rebalance

**Acceptance**

- Exposure changes are bounded under adversarial price paths
- No rapid repeated large reallocations

**Validate**

- Property tests or adversarial fixture tests for boundedness

---

### M6 — CLMM Carry module (CHOP-only) with carry score gate

**Scope**

- Carry score function: expectedFees / realizedVol
  - expectedFees initially can be proxied by historical realized fees or pool fee APR proxy (config-driven)
- Liquidity/impact gate (quote impact at intended size <= threshold)
- Enforce CHOP-only opens; exit-only behavior in UP/DOWN

**Acceptance**

- No CLMM opens in UP or DOWN fixtures
- In CHOP fixtures with adequate carry score, CLMM open is allowed
- If impact too high, refuse and record reason

**Validate**

- Tests across regimes + refusal cases

---

### M7 — Execution Engine refactor: Plan → Builder → Checkpointed Executor

**Scope**

- Create an execution state machine with checkpoints:
  - `PLAN_CREATED`
  - `CLOSE_CONFIRMED`
  - `SWAP_CONFIRMED`
  - `RECEIPT_CONFIRMED`
- Idempotency:
  - receipt pre-check
  - resume from checkpoints after crash/restart
- Strict constraints:
  - slippage caps
  - quote freshness
  - bounded retries
  - safe-mode refusal (no trade)

**Acceptance**

- Simulated “crash mid-flight” resumes without double execution
- Duplicate execution attempts are blocked by receipt

**Validate**

- Unit tests with mocked RPC/adapter
- Devnet harness run: simulate + execute + receipt exists

---

### M8 — Quote sanity + adverse condition refusal

**Scope**

- Quote freshness enforcement (time and/or slot)
- Reject anomalous quotes (impact blowout)
- Deterministic refusal Plan + notification event

**Acceptance**

- Under synthetic bad-liquidity inputs, executor refuses rather than filling badly
- Ledger reflects refusal reason and no send occurs

**Validate**

- Tests asserting refusal + no tx submission

---

### M9 — Operator UX + Shadow mode

**Scope**

- UI displays:
  - regime + why
  - target vs current exposure
  - CLMM status + carry score
  - churn budgets + timers
  - preview Plan + simulate results
- Shadow mode toggle: compute + simulate + ledger only

**Acceptance**

- Operator can run shadow → simulate → execute
- All actions logged to ledger

**Validate**

- UI smoke + E2E devnet script

---

### M10 — Weekly scorecard + promotion gates

**Scope**

- Report generator from ledger only:
  - sleeve return
  - max drawdown proxy
  - baselines comparison
  - churn + execution metrics
- Promotion gates (sizing readiness):
  - min sample size
  - max drawdown threshold
  - min execution success rate
  - max churn thresholds

**Acceptance**

- One command emits `artifacts/weekly_report.md` from ledger

**Validate**

- Snapshot tests for report output
