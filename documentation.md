# Regime Engine — documentation.md

This document is updated continuously as milestones land so it reflects reality. 0

## What Regime Engine is

- A local-first **policy + analytics** microservice that produces deterministic trading plans.
- It classifies market regime (**UP / DOWN / CHOP**) with hysteresis, applies churn governance, and outputs target exposures (**SOL/USDC bps**) plus **REQUEST_\*** actions for an external execution service.
- It maintains an append-only **truth ledger** of plan requests, plans, and execution results, and can generate weekly reports from the ledger only.

## What Regime Engine is not

- It does **not** execute trades.
- It does **not** talk to Solana RPC, Orca, Jupiter, wallets, or receipts.
- It does **not** manage CLMM positions. It only emits `allowClmm` and `REQUEST_ENTER_CLMM` / `REQUEST_EXIT_CLMM` actions.

## Status

- Milestone 01: pending
- Milestone 02: pending
- Milestone 03: pending
- Milestone 04: pending
- Milestone 05: pending
- Milestone 06: pending
- Milestone 07: pending
- Milestone 08: pending
- Milestone 09: pending
- Milestone 10: pending
- Milestone 11: pending
- Milestone 12: pending
- Milestone 13: pending
- Milestone 14: pending
- Milestone 15: pending
- Milestone 16: pending

(Keep this list current as you check milestones off in `plan.md`.)

## Local setup

- Node LTS on macOS.
- Install deps: `npm install`
- Start service: `npm run dev`
- Health check: `http://localhost:8787/health` (or configured port)
- OpenAPI: `http://localhost:8787/v1/openapi.json`

## Verification commands

- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Tests: `npm run test`
- Build: `npm run build`

## One-command demo (target state)

1) `npm run dev`
2) In another terminal:
   - `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
3) Inspect:
   - `tmp/reports/weekly-*.md`
   - `tmp/reports/weekly-*.json`

## HTTP API overview

### `GET /health`

Returns a small JSON payload confirming the server is running.

### `GET /version`

Returns build metadata (service name/version; optional commit hash if injected at build time).

### `GET /v1/openapi.json`

Returns the OpenAPI document for all v1 endpoints.

### `POST /v1/plan`

Input: candles + portfolio state + autopilot counters + config.

Output: deterministic PlanResponse:

- `planId`, `planHash`
- `regime`: `UP | DOWN | CHOP`
- `targets`: `{ solBps, usdcBps, allowClmm }`
- `actions[]`: `REQUEST_*` plus optionally `HOLD`/`STAND_DOWN`
- `constraints`: cooldowns/budgets/notes
- `reasons[]`: canonical reason codes with severity
- `telemetry`: computed indicators for inspection

### `POST /v1/execution-result`

Input: `(planId, planHash)` + per-action statuses + costs + `portfolioAfter`.

Behavior:

- Reject if `planId` not found or `planHash` mismatch.
- Persist a linked execution result row.
- Execution results are the authoritative source of realized costs and portfolio-after values.

### `GET /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns weekly report output built from ledger only:

- markdown report + JSON summary
- regime distribution
- churn / stand-down stats
- execution success + costs (as reported by Autopilot)
- baselines: SOL HODL, SOL DCA, USDC carry

## How Regime Engine interacts with the CLMM Autopilot microservice

### Contract boundary

- Regime Engine produces **policy intent**:
  - “what should be attempted next” (REQUEST_* actions)
  - “what is allowed” (allowClmm)
  - “how aggressively” (targets + caps + constraints)
- Autopilot produces **execution truth**:
  - what actually executed
  - costs and slippage
  - portfolioAfter

### Typical loop

1) Autopilot gathers candles + its own internal counters/cooldowns and calls `POST /v1/plan`.
2) Regime Engine returns a Plan (deterministic, hashed).
3) Autopilot decides whether to execute and then posts `POST /v1/execution-result`.
4) Regime Engine logs results and reports on outcomes.

## Repo structure overview (target)

- `src/contract/v1/*`
  - request/response types, validation, canonical JSON, hashing
- `src/engine/*`
  - `features/*` candle parsing + indicators (pure)
  - `regime/*` regime classifier + hysteresis (pure)
  - `churn/*` churn governor (pure)
  - `allocation/*` partial shifts + caps + vol targeting (pure)
  - `plan/*` plan builder (pure)
- `src/http/*`
  - routes, handlers, OpenAPI, error taxonomy
- `src/ledger/*`
  - sqlite schema, store, writer
- `src/report/*`
  - baselines, weekly report generator (ledger-only)
- `scripts/*`
  - harness to drive fixtures → plan → simulated results → report
- `fixtures/*`
  - deterministic candle sequences + autopilotState progressions

## Determinism rules

- Canonical JSON serialization is required for:
  - planHash
  - snapshot tests
  - stable ledger-derived reporting artifacts
- Stable ordering requirements:
  - object keys are sorted
  - arrays are either preserved as-is from input or explicitly sorted (document which)
- Any detected non-determinism is a blocker.

## Baselines (for weekly reports)

- SOL HODL: hold SOL units constant across the window.
- SOL DCA: buy SOL on a fixed schedule (defined in config).
- USDC carry: apply a configurable APR on USDC balance (defined in config).
  Baselines must be computed from candle close prices only.

## Troubleshooting

- Port already in use: kill the prior process or change `PORT`.
- Hash mismatch on `/v1/execution-result`: Autopilot posted a mutated plan or stale planHash; it must post the exact `(planId, planHash)` returned by `/v1/plan`.
- Report is empty: no ledger rows in the requested window, or execution results were never posted.
- Regime flaps in fixtures: hysteresis thresholds too tight or `confirmBars/minHoldBars` misconfigured; fix policy defaults and lock with fixtures + snapshot tests.
