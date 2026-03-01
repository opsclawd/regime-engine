# Regime Engine — implement.md (Long-Horizon Execution Runbook)

This runbook defines the non-negotiable operating rules for completing the entire Regime Engine microservice end-to-end in a single long-horizon Codex session, milestone-by-milestone, without pausing for confirmation. 0

---

## Non-negotiable constraints

- Do not stop after a milestone to ask questions or wait for confirmation.
- Proceed through every milestone in `plan.md` until the whole project is complete and fully validated.
- Regime Engine scope only:
  - Policy compute + ledger + reporting + HTTP contract.
  - No on-chain execution (no Orca/Jupiter/Solana RPC), beyond integration stubs for contract tests.

---

## Execution rules (follow strictly)

### Source of truth

- Treat `plan.md` as the source of truth.
- If anything is ambiguous:
  - Make a reasonable decision
  - Record the decision in `plan.md` under **Implementation Notes**
  - Then code it

### Milestone loop (repeat for each milestone)

1) Read: `prompt.md`, `plan.md`, `documentation.md`, `architecture.md`
2) Identify the first incomplete milestone in `plan.md`
3) Implement ONLY the scope of that milestone
4) Add/update tests for the milestone’s core behavior (unit + snapshot where required)
5) Run milestone verification commands (or full sweep)
6) If any verification fails:
   - write/adjust a failing test that reproduces it (where applicable)
   - fix the bug
   - re-run verification until green
   - record a short note in `plan.md` under **Implementation Notes**
7) Update docs:
   - `documentation.md`: how to run + what changed + known issues
   - `architecture.md`: only if architecture changed
8) Mark milestone complete in `plan.md`
9) Commit with a small, reviewable diff

### Commit discipline

- Keep commits small and scoped.
- Commit message format:
  - `mXX: <milestone title>`
- Avoid bundling unrelated refactors.

---

## Validation requirements

- Maintain a “Verification checklist” section in `plan.md` that stays accurate as the repo evolves.
- Determinism is mandatory for:
  - canonical serialization
  - hashing
  - journaling/ledger writes (given stable ids/timestamps where required)
  - reporting output
- Enforce determinism with:
  - snapshot tests
  - stable ordering (explicit sorting)
  - canonical JSON serialization

If determinism breaks at any point, treat it as a blocker and fix immediately.

---

## Documentation requirements

Create and maintain `documentation.md` as a concise operator doc. Keep it updated as you implement so it matches reality. By the end, `documentation.md` must include:

- What Regime Engine is (and what it is not)
- Local setup and one-command dev start
- How to run tests, lint, typecheck, build
- How to run the harness/report CLI with examples
- How to demo in <3 minutes (plan → execution-result → weekly report)
- Repo structure overview
- Contract overview (v1 endpoints + key request/response fields)
- Determinism strategy (canonical JSON, planHash, snapshots)
- Troubleshooting (top issues and fixes)

---

## Completion criteria (do not stop until all are true)

- All milestones in `plan.md` are implemented and checked off.
- `npm run dev` works and serves:
  - `/health`
  - `/v1/openapi.json`
- `/v1/plan`:
  - validates inputs
  - produces deterministic PlanResponse
  - writes ledger rows
- `/v1/execution-result`:
  - validates planId + planHash linkage
  - writes ledger rows
- Weekly report endpoint and CLI:
  - produce deterministic output from ledger only
  - include baseline comparisons (SOL HODL, SOL DCA, USDC carry)
- Determinism snapshot tests exist and pass for:
  - canonical JSON serialization
  - plan hashing
  - plan determinism fixtures
  - weekly report output
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass.
- `documentation.md` is accurate and complete.

---

## Start procedure

1) Read `plan.md`
2) Begin Milestone 01
3) Continue sequentially until final validation sweep passes and completion criteria are satisfied
