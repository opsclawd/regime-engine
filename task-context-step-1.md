# Task Context: Task 1

Title: Define and validate the versioned policy ruleset
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

- Create: `src/engine/policy/ruleset.ts`
- Create: `src/engine/policy/__tests__/ruleset.test.ts`

- [ ] **Step 1: Write failing ruleset tests first**

  Add named tests `accepts and freezes sol-usdc-policy.v1`, `rejects non-monotone thresholds`, `rejects duplicate reason ordering`, `rejects unsupported binding type or unit`, and `rejects an expiry configuration without a positive safety ttl`. Assert deep immutability and exact rejection messages.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/ruleset.test.ts`

  Expected: FAIL because `ruleset.ts` and its exports do not exist.

- [ ] **Step 3: Implement the immutable ruleset**

  Define the complete first-version policy surface in one file:

  ```ts
  export const POLICY_RULESET_VERSION = "sol-usdc-policy.v1" as const;

  export interface PolicyFeatureBinding {
    readonly bindingId: string;
    readonly family: string;
    readonly featureId: string;
    readonly calculatorName: string;
    readonly calculatorVersion: string;
    readonly kind: "number";
    readonly unit: string;
    readonly tighten: "risk" | "confidence" | "capital" | "range" | "support" | "resistance";
    readonly threshold: number;
  }

  export interface PolicyRuleset {
    readonly version: typeof POLICY_RULESET_VERSION;
    readonly maxInsightLifetimeMs: number;
    readonly positionMaxAgeMs: number;
    readonly degradedSafetyTtlMs: number;
    readonly confidenceOrder: readonly string[];
    readonly riskOrder: readonly string[];
    readonly postureOrder: readonly string[];
    readonly rangeBiasOrder: readonly string[];
    readonly reasonOrder: Readonly<Record<string, number>>;
    readonly featureBindings: readonly PolicyFeatureBinding[];
  }

  export declare const validatePolicyRuleset: (candidate: PolicyRuleset) => PolicyRuleset;
  export declare const SOL_USDC_POLICY_V1: PolicyRuleset;
  ```

  Use #63 enum values directly in the real implementation. Encode every precedence stage, monotone categorical order, freshness/expiry threshold, support/resistance limit, and deterministic feature binding in the ruleset; no reducer constant may silently alter output outside this version.

- [ ] **Step 4: Verify GREEN and local quality**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/ruleset.test.ts`

  Run: `pnpm exec eslint src/engine/policy/ruleset.ts src/engine/policy/__tests__/ruleset.test.ts`

  Expected: all focused tests pass and ESLint reports no warnings.

- [ ] **Step 5: Commit the task**

  Run: `git add src/engine/policy/ruleset.ts src/engine/policy/__tests__/ruleset.test.ts && git commit -m "m61: define policy synthesis ruleset"`

## Repository Targets

### Expected Files
- src/engine/policy/ruleset.ts
- src/engine/policy/__tests__/ruleset.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/policy/__tests__/ruleset.test.ts
pnpm exec eslint src/engine/policy/ruleset.ts src/engine/policy/__tests__/ruleset.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **immutable valid ruleset**: The accepted sol-usdc-policy.v1 configuration is defensively copied and deeply frozen. (Test: `accepts and freezes sol-usdc-policy.v1`)
- **monotone threshold order**: A ruleset whose confidence, risk, posture, range, or threshold ordering can relax a higher guard is rejected. (Test: `rejects non-monotone thresholds`)
- **unambiguous reason precedence**: Every configured machine reason has one unique deterministic order. (Test: `rejects duplicate reason ordering`)
- **strict deterministic feature binding**: Unsupported feature types or units cannot acquire policy meaning. (Test: `rejects unsupported binding type or unit`)

