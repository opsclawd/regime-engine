# Execution Runbook (Codex Long Horizon)

## Source of truth

- `Prompt.md` is the spec and constraints.
- `Plan.md` is the milestone checklist and acceptance criteria.
- `Documentation.md` is the shared memory / audit log.

## Operating loop (repeat for each milestone)

1) Read `Prompt.md`, `Plan.md`, and current `Documentation.md`.
2) Identify the first incomplete milestone in `Documentation.md`.
3) Implement only what that milestone requires. Do not expand scope.
4) Run the milestone’s validation commands.
5) If validation fails: fix immediately, re-run validations.
6) Update `Documentation.md`:
   - what changed
   - what commands were run
   - results
   - decisions made (with reason)
   - next milestone
7) Commit with a milestone-scoped message (unless repo policy says otherwise).

## Rules (non-negotiable)

- Do not skip tests or validations.
- Keep diffs minimal and milestone-scoped.
- Prefer pure functions and typed contracts in the strategy layer.
- Never introduce unattended automation; Phase 1 remains one-click user signing.
- Refuse behavior must be explicit and logged (never “best effort” silent failure).

## Safety / determinism requirements

- Strategy evaluation must be deterministic and unit-testable with fixtures.
- Execution must be checkpointed and idempotent (safe restart, no duplicates).
- Receipt existence must be checked before building and before sending.
- All important decisions must be explainable via reason codes.

## Expected quality commands

Run frequently:

- `pnpm -r lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`

## Output artifacts

Ensure the run produces artifacts in a stable location (suggested: `artifacts/`):

- `artifacts/plan.json`
- ledger file (JSONL or SQLite)
- `artifacts/weekly_report.md` (by M10)
