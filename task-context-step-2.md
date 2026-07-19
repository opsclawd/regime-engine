# Task Context: Task 2

Title: Implement hard-guard and market-regime precedence
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-61
Repository: opsclawd/regime-engine
Branch: ai/issue-61
Start Commit: 8eb83b2403a525df9fbb640f75379bc56dc7bc3c

## Task Requirements

**Files:**

- Create: `src/engine/policy/synthesizePolicyInsight.ts`
- Create: `src/engine/policy/__tests__/policyFixtures.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

**Invariants implemented first:**

- `hard-stale market locks pause posture and blocks CLMM despite bullish evidence`
- `qualified lower breach remains exit_range under bullish contextual evidence`
- `qualified upper breach remains exit_range under bearish contextual evidence`
- `active stand-down prevents lower-precedence deployment increases`
- `cooldown never permits higher sensitivity or capital than the baseline`

- [ ] **Step 1: Build canonical fixtures and write failing precedence tests**

  Create builders for fixed #63-valid pair scope, market snapshots, optional position/plan context, and empty/full #60 summaries. Table-drive stages 1-4: hard stale/insufficient safety data, lower and upper qualified breaches, blocked active position, stand-down, cooldown, `UP`, `DOWN`, and `CHOP`/`ALLOWED`. Assert exact advisory action, posture, risk floor, confidence ceiling, CLMM permission, reason order, and expiry.

- [ ] **Step 2: Run the focused precedence suite and confirm RED**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

  Expected: FAIL because the reducer is not implemented.

- [ ] **Step 3: Implement the pure ordered reducer**

  Export a reducer with an immutable envelope and explicit lock state:

  ```ts
  export interface PolicySynthesisEnvelope {
    readonly synthesisAtUnixMs: number;
    readonly pair: "SOL/USDC";
    readonly scope: Scope;
    readonly market: RegimeCurrentResponse;
    readonly positionPlan: {
      readonly position: PlanRequestPosition;
      readonly plan: PlanResponse;
    } | null;
    readonly evidence: SelectedEvidenceSummary;
    readonly hashes: PolicySynthesisHashes;
  }

  export function synthesizePolicyInsight(
    envelope: PolicySynthesisEnvelope,
    ruleset: PolicyRuleset
  ): PolicyInsightV1;
  ```

  Apply stages in fixed order. Represent locks explicitly (`action`, `posture`, `riskFloor`, `confidenceCeiling`, `allowClmm`, capital/sensitivity bounds) and expose no generic score that can cancel a guard. Map authoritative plan actions (`REQUEST_EXIT_CLMM`, `STAND_DOWN`, `HOLD`) without re-running breach or churn qualification. Compute expiry as the earliest ruleset, market, position, and selected-evidence boundary.

- [ ] **Step 4: Verify precedence and boundary isolation**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

  Run: `pnpm exec eslint src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

  Run: `pnpm exec depcruise --config .dependency-cruiser.cjs --output-type err "src/engine/policy/**/*.ts"`

  Expected: all scenarios pass; the policy engine imports only engine/contract modules and runtime-free types.

- [ ] **Step 5: Commit the task**

  Run: `git add src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts && git commit -m "m61: enforce policy precedence guards"`

## Repository Targets

### Expected Files
- src/engine/policy/synthesizePolicyInsight.ts
- src/engine/policy/__tests__/policyFixtures.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts
pnpm exec eslint src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/policyFixtures.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts
pnpm exec depcruise --config .dependency-cruiser.cjs --output-type err "src/engine/policy/**/*.ts"
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **hard stale dominates evidence**: A hard-stale or unsafe market state pauses rebalances, blocks CLMM, floors risk, and caps confidence regardless of bullish lower-priority evidence. (Test: `hard-stale market locks pause posture and blocks CLMM despite bullish evidence`)
- **lower breach cannot reverse**: A fresh qualified below-range breach remains an advisory exit even when contextual evidence is bullish. (Test: `qualified lower breach remains exit_range under bullish contextual evidence`)
- **upper breach cannot reverse**: A fresh qualified above-range breach remains an advisory exit even when contextual evidence is bearish. (Test: `qualified upper breach remains exit_range under bearish contextual evidence`)
- **stand-down lock**: An active authoritative stand-down fixes pause posture and CLMM denial until its supplied boundary. (Test: `active stand-down prevents lower-precedence deployment increases`)
- **cooldown caution floor**: Cooldown state cannot result in increased sensitivity or capital deployment. (Test: `cooldown never permits higher sensitivity or capital than the baseline`)

