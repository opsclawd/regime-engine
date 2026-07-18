# Task Context: Task 5

Title: Correct current architecture and API documentation
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-55
Repository: opsclawd/regime-engine
Branch: ai/issue-55
Start Commit: bbd4e0d6cb492a7e4ed4cbcc6a2f59e1161aaeea

## Task Requirements

**Files:**

- Modify: `README.md`
- Modify: `architecture.md`
- Modify: `documentation.md`
- Modify: `src/adapters/http/openapi.ts`
- Modify: `src/composition/__tests__/buildApp.e2e.test.ts`
- Modify: `docs/solutions/best-practices/composition-root-pattern-2026-05-08.md`

- [ ] **Step 1: Add an OpenAPI regression assertion.** Extend only the existing `serves /v1/openapi.json` case to assert the weekly endpoint summary states that report facts come from the ledger and baseline prices come from the active canonical candle store.

- [ ] **Step 2: Run the focused OpenAPI test and confirm the old “ledger data” summary fails the new assertion.**

  ```bash
  pnpm exec vitest run src/composition/__tests__/buildApp.e2e.test.ts -t "serves /v1/openapi.json"
  ```

- [ ] **Step 3: Update current documentation.** In README and architecture descriptions, replace “ledger-only” with the precise split: append-only SQLite provides plan/execution facts; the active SQLite/PostgreSQL `CandleReadPort` provides SOL baseline closes. Update the weekly-report flow to include complete feed selection, canonical 15-minute source timeframe, and closed cutoff. In `documentation.md`, correct current endpoint/module descriptions while leaving dated Milestone 15 claims explicitly framed as historical implementation history.

- [ ] **Step 4: Update the durable composition-root solution.** Show `WeeklyReportLedgerReadPort` plus the selected `CandleReadPort` entering `createGetWeeklyReportUseCase`; remove the obsolete high-level SQLite weekly adapter example. Do not rewrite unrelated historical guidance.

- [ ] **Step 5: Update the OpenAPI summary and run scoped acceptance checks.**

  ```bash
  pnpm exec vitest run src/composition/__tests__/buildApp.e2e.test.ts -t "serves /v1/openapi.json"
  pnpm exec prettier --check README.md architecture.md documentation.md src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts docs/solutions/best-practices/composition-root-pattern-2026-05-08.md
  pnpm exec eslint src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts
  ```

  Expected: the focused contract assertion passes and all changed documentation/code is formatted.

- [ ] **Step 6: Commit the documentation correction.**

  ```bash
  git add README.md architecture.md documentation.md src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts docs/solutions/best-practices/composition-root-pattern-2026-05-08.md
  git commit -m "m55: document canonical report candle authority"
  ```

**Tests to add or update**

- Add mirrored SQLite/PostgreSQL candle-window adapter contracts for complete feed isolation, inclusive bounds, revision tie-breaking, deterministic order, and empty results.
- Expand baseline tests to prove canonical-only authority, defensive window filtering, deterministic sorting, empty candles, and no requests.
- Add SQLite weekly-ledger adapter tests for parsed windows, stable row ordering, malformed persisted JSON, and range-error translation.
- Replace pass-through weekly use-case tests with feed-selection, `15m`/`1h`, cutoff, missing-feed, empty-store, and error-propagation cases.
- Update deterministic weekly report snapshots to use explicit report facts and candles.
- Add SQLite-only and PostgreSQL-backed composition tests, including conflicting SQLite data and empty-active-store no-fallback cases.
- Extend the existing OpenAPI composition test only within its weekly endpoint assertion.

**Validation commands**

Run after all implementation tasks complete; this is the validate phase, not a standalone implementation task:

```bash
pnpm -r typecheck
pnpm run test
pnpm run lint
pnpm run build
pnpm run boundaries
pnpm run format
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
```

Expected: every command exits zero. The PostgreSQL command requires the repository's test database; inability to connect is an environment blocker, not permission to mark PostgreSQL coverage complete.

**Risk areas**

- The shared closed-candle delay can intentionally exclude the last nominal bar; boundary fixtures must calculate expectations through `buildRegimeCandleReadPlan`, not hard-code a looser report cutoff.
- PostgreSQL numeric values may arrive as strings; the existing null guard and `Number(...)` conversion must remain common to both read methods.
- Reports spanning several market feeds still select one baseline feed. Preserving the first complete chronological request avoids an unrequested multi-feed redesign.
- Existing snapshots may change because old SQLite/inline prices were wrong. Accept only differences explained by the new explicit canonical fixtures; public fields and Markdown structure must not drift.
- Malformed legacy requests may lack the modern market shape. They remain in totals/config ordering but cannot select a feed unless all required fields and a supported timeframe are present.
- Large report ranges can return many candles. The bounded indexed query is intentional; adding a guessed limit would silently truncate results.
- PostgreSQL tests share a database. Unique feed keys and scoped cleanup are required to avoid deleting another suite's rows.

**Stop conditions**

- Stop if repository types show that plan requests cannot provide `symbol`, `source`, `network`, `poolAddress`, and supported `timeframe` without changing the public request contract; revise the design rather than inventing feed defaults.
- Stop if implementing the window read requires a schema migration or index change not described by the design; document the query-plan evidence and obtain scope approval.
- Stop if any existing `CandleReadPort` implementation or fake is discovered beyond the SQLite adapter, PostgreSQL adapter, and application fake; add it to Task 1 before changing the interface.
- Stop if preserving the weekly response schema, formulas, deterministic ordering, or 400/500 error taxonomy proves incompatible with explicit report inputs.
- Stop if a proposed fix catches candle-store failures, probes a second store, reuses inline request candles, or reads `candle_revisions` from the weekly SQLite ledger adapter.
- Stop before claiming PostgreSQL acceptance if the configured test database cannot run the new adapter and composition suites.

## Repository Targets

### Expected Files
- README.md
- architecture.md
- documentation.md
- src/adapters/http/openapi.ts
- src/composition/__tests__/buildApp.e2e.test.ts
- docs/solutions/best-practices/composition-root-pattern-2026-05-08.md

## Validation Commands

```bash
pnpm exec vitest run src/composition/__tests__/buildApp.e2e.test.ts -t "serves /v1/openapi.json"
pnpm exec prettier --check README.md architecture.md documentation.md src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts docs/solutions/best-practices/composition-root-pattern-2026-05-08.md
pnpm exec eslint src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts
```

