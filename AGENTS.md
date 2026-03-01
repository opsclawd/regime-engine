# AGENTS.md — Regime Engine Microservice Guidelines

This file defines how agents (Codex/OpenClaw/opencode) must operate in this repo: structure, commands, style, tests, and PR discipline. Modeled after the provided blueprint. 0

## Project Structure & Module Organization

Target layout (keep responsibilities stable even if filenames change):

- `src/contract/v1/`
  - v1 request/response types, runtime validation, canonical JSON, hashing
- `src/engine/`
  - pure policy kernel (no HTTP/DB)
  - `features/` indicators from candles
  - `regime/` UP/DOWN/CHOP classifier + hysteresis
  - `churn/` budgets/cooldowns/stand-down
  - `allocation/` targets + caps + vol targeting
  - `plan/` plan builder orchestration
- `src/http/`
  - Fastify/Express routes + handlers, OpenAPI, error taxonomy
- `src/ledger/`
  - SQLite schema, store, writer, queries
- `src/report/`
  - baselines + weekly report generation (ledger-only)
- `scripts/`
  - harness runner (fixtures → /v1/plan → /v1/execution-result → report)
- `fixtures/`
  - deterministic candle sequences + autopilot state progressions

Tests:

- Co-locate tests in `__tests__` folders near the code they cover.

Hard boundary:

- No on-chain execution code in this repo (no Orca/Jupiter/Solana RPC).

## Build, Test, and Development Commands

These commands must exist and stay accurate:

- `npm run dev`: start local server (must serve `/health`)
- `npm run build`: production build (tsup/tsc + bundler as chosen)
- `npm run typecheck`: strict TypeScript checks without emitting
- `npm run lint`: ESLint across repo with zero warnings allowed
- `npm run test`: Vitest once (CI mode)
- `npm run test:watch`: Vitest in watch mode (optional)
- `npm run format`: Prettier check/write (optional but recommended)
- `npm run harness`: run fixtures end-to-end and emit report artifacts

Quality gate (must pass before PR):

- `npm run typecheck && npm run test && npm run lint && npm run build`

## Coding Style & Naming Conventions

- Language: TypeScript (`.ts`), Node LTS.
- Indentation: 2 spaces.
- Prefer explicit code over cleverness. Determinism beats micro-optimizations.
- File naming:
  - modules: `camelCase.ts` for utilities, `PascalCase` not used (no React here)
  - tests: `*.test.ts` and `*.snapshot.test.ts` when snapshotting determinism
- Determinism rules:
  - Sort object keys where serialization/hashing depends on order.
  - Never rely on implicit iteration order of Maps/Sets.
  - Canonical JSON is the only input to `planHash`.

## Testing Guidelines

- Framework: Vitest.
- Test location: `__tests__` folders near code.
- Required coverage:
  - Contract validation + error taxonomy tests
  - Canonical JSON + planHash snapshot tests
  - Plan determinism fixture tests (same input → byte-identical plan JSON + same hash)
  - Weekly report determinism snapshot tests (same ledger → byte-identical report output)
  - Churn governor “whipsaw” fixture tests (prove stand-down works)

## Commit & Pull Request Guidelines

- Keep commits focused and scoped to a single milestone/task.
- Commit message format (preferred for this repo): `mXX: <milestone title>`
- PR must include:
  - short summary (problem → solution)
  - validation commands run (copy/paste)
  - any behavior changes + fixture updates
  - notes on determinism impacts (if touched)

## Architecture Notes (Quick Map)

- Pure core lives in `src/engine/` and must be runnable in unit tests without HTTP/DB.
- Boundary adapters:
  - `src/http/` handles IO + validation + OpenAPI
  - `src/ledger/` persists append-only truth records
  - `src/report/` reads ledger only and produces weekly outputs
- Authority model:
  - Regime Engine is authoritative for “what was planned”
  - Autopilot is authoritative for “what executed” + costs + portfolioAfter
  - Regime Engine never claims execution happened; only emits REQUEST_* actions
