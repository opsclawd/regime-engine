# Fix Precedence Locks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure lower-precedence stages do not overwrite actionLock and postureLock set by higher-precedence stages in synthesizePolicyInsight.ts.

**Architecture:** Use nullish coalescing assignment operators (`??=`) for lock and constraint variables in synthesizePolicyInsight.ts so they are only updated if they haven't already been set by a higher-precedence stage.

**Tech Stack:** TypeScript, Vitest

## Global Constraints

- Sort object keys where serialization/hashing depends on order.
- Never rely on implicit iteration order of Maps/Sets.
- Canonical JSON is the only input to planHash.

---

### Task 1: Add a failing test for Stage 1 vs Stage 2/3 Precedence

**Files:**

- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`

**Interfaces:**

- Consumes: `synthesizePolicyInsight` function
- Produces: A failing test verifying that Stage 1 hard-stale / blocked data locks take precedence and are not overwritten by Stage 2 breach or Stage 3 stand-down / cooldown actions.

- [ ] **Step 1: Write the failing test**
      Add a new test inside `src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts` that combines a Stage 1 condition (e.g. hardStale: true) with a Stage 2 condition (e.g. exitAction/REQUEST_EXIT_CLMM) or Stage 3 condition. Verify that `recommendedAction` remains `"pause_rebalances"` (set by Stage 1) instead of `"exit_range"` (set by Stage 2).

  Code to add:

  ```typescript
  it("Stage 1 hard-stale lock is not overwritten by Stage 2 exit_range breach lock", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({
        regime: "UP",
        freshness: {
          generatedAtIso: new Date(AS_OF - 5000).toISOString(),
          lastCandleOpenUnixMs: AS_OF - 3600000,
          lastCandleOpenIso: new Date(AS_OF - 3600000).toISOString(),
          lastCandleCloseUnixMs: AS_OF - 60000,
          lastCandleCloseIso: new Date(AS_OF - 60000).toISOString(),
          ageSeconds: 5,
          softStale: false,
          hardStale: true,
          softStaleSeconds: 1500,
          hardStaleSeconds: 2100
        }
      }),
      positionPlan: {
        position: makeMockPosition({
          rangeState: "below-range",
          breachQualified: true
        }),
        plan: makeMockPlan({
          actions: [{ type: "REQUEST_EXIT_CLMM", reasonCode: "BREACH" }]
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    // Stage 1 (DATA_HARD_STALE) sets actionLock = "pause_rebalances"
    // Stage 2 (BREACH) sets actionLock = "exit_range"
    // Since Stage 1 has higher precedence, recommendedAction must be "pause_rebalances"
    expect(result.recommendedAction).toBe("pause_rebalances");
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm run test src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`
      Expected: FAIL (recommendedAction is "exit_range" instead of "pause_rebalances")

---

### Task 2: Implement Precedence Protection in synthesizePolicyInsight

**Files:**

- Modify: `src/engine/policy/synthesizePolicyInsight.ts`

**Interfaces:**

- Consumes: None
- Produces: Updated `synthesizePolicyInsight` function logic preventing lower-precedence overwrites.

- [ ] **Step 1: Write minimal implementation**
      Replace assignments to `actionLock`, `postureLock`, `riskFloor`, and `confidenceCeiling` in Stage 2 and Stage 3 with nullish coalescing assignment operators (`??=`).

  Target content:

  ```typescript
  // Stage 2: Qualified lower and upper breaches
  if (envelope.positionPlan?.plan?.actions) {
    const exitAction = envelope.positionPlan.plan.actions.find(
      (a) => a.type === "REQUEST_EXIT_CLMM"
    );
    if (exitAction) {
      actionLock = "exit_range";
      allowClmm = false;
  ```

  Replacement content:

  ```typescript
  // Stage 2: Qualified lower and upper breaches
  if (envelope.positionPlan?.plan?.actions) {
    const exitAction = envelope.positionPlan.plan.actions.find(
      (a) => a.type === "REQUEST_EXIT_CLMM"
    );
    if (exitAction) {
      actionLock ??= "exit_range";
      allowClmm = false;
  ```

  Target content:

  ```typescript
  // Stage 3: Churn governor (Stand-down and Cooldown)
  const standDownUntil = envelope.positionPlan?.plan?.constraints?.standDownUntilUnixMs ?? 0;
  const isStandDownAction = envelope.positionPlan?.plan?.actions?.some(
    (a) => a.type === "STAND_DOWN"
  );
  if (isStandDownAction || standDownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_STAND_DOWN_ACTIVE");
    actionLock = "pause_rebalances";
    postureLock = "paused";
    allowClmm = false;
  }

  const cooldownUntil = envelope.positionPlan?.plan?.constraints?.cooldownUntilUnixMs ?? 0;
  if (cooldownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_COOLDOWN_ACTIVE");
    capitalCap = baselineCapital;
    sensitivityCap = baselineSensitivity;
  }
  ```

  Replacement content:

  ```typescript
  // Stage 3: Churn governor (Stand-down and Cooldown)
  const standDownUntil = envelope.positionPlan?.plan?.constraints?.standDownUntilUnixMs ?? 0;
  const isStandDownAction = envelope.positionPlan?.plan?.actions?.some(
    (a) => a.type === "STAND_DOWN"
  );
  if (isStandDownAction || standDownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_STAND_DOWN_ACTIVE");
    actionLock ??= "pause_rebalances";
    postureLock ??= "paused";
    allowClmm = false;
  }

  const cooldownUntil = envelope.positionPlan?.plan?.constraints?.cooldownUntilUnixMs ?? 0;
  if (cooldownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_COOLDOWN_ACTIVE");
    capitalCap ??= baselineCapital;
    sensitivityCap ??= baselineSensitivity;
  }
  ```

- [ ] **Step 2: Run test to verify it passes**
      Run: `pnpm run test src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`
      Expected: PASS

- [ ] **Step 3: Run the full validation check**
      Run: `pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build`
      Expected: PASS with 0 errors/warnings

- [ ] **Step 4: Commit and finalize**
      Record HEAD before: `PRE_HEAD=$(git rev-parse HEAD)`
      Stage and commit: `git add -A && git commit -m "fix: review findings"`
      Verify HEAD advanced and worktree is clean.
