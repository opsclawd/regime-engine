# Task Context: Task 1

Title: Merge canonical SR theses in the pure policy reducer
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-82
Repository: opsclawd/regime-engine
Branch: ai/issue-82
Start Commit: cd8632d937da99fe51784b51216fc82d9df84458

## Task Requirements

**Files:**

- Modify: `src/engine/policy/synthesizePolicyInsight.ts`
- Create: `src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts`
- Reference: `src/contract/v2/srLevels.ts`
- Reference: `src/engine/policy/__tests__/policyFixtures.ts`
- Reference: `src/engine/policy/reasoning.ts`

**Behavioral invariants (write these named tests first):**

1. `adds valid SR thesis levels and identities without replacing evidence-derived inputs`
   - Given valid SR-ledger supports/resistances and an evidence-derived numeric level, the output contains the eligible union and reasoning includes the SR `briefId` exactly once even when the brief has multiple theses; neither source removes the other.
2. `combines SR and evidence bias votes and treats opposition as conflict`
   - Given a bullish SR thesis and bearish contextual evidence, the existing conflict policy applies: risk is elevated and confidence is capped low. Given aligned votes, the normal directional vote behavior applies once, without bypassing higher-precedence locks.
3. `ignores non-finite non-positive and side-ineligible SR level strings`
   - `NaN`, infinities, zero, negatives, supports above current price, and resistances below current price do not appear in output levels; valid supports and resistances do.
4. `deduplicates sorts and caps SR levels with existing output rules`
   - Duplicate strings/numeric equivalents collapse, supports sort descending, resistances sort ascending, and each output side contains at most 16 values.
5. `produces byte-identical output for the same canonical SR thesis input`
   - Repeated reducer calls with the same envelope produce byte-identical JSON.
6. `preserves legacy reducer behavior when SR theses are absent`
   - Omitting `srTheses` is equivalent to passing `srTheses: []`, preserving historical input compatibility.

- [ ] **Step 1: Create the focused failing reducer tests**

Build envelopes from `calmChopMarket` and `makeMockEvidenceSummary`. Use a synthesis thesis with explicit identity and string levels:

```ts
const srThesis: PolicySynthesisSrThesis = {
  source: "mco",
  briefId: "mco-sol-2026-07-30",
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: null,
  supportLevels: ["95", "90", "0", "not-a-number"],
  resistanceLevels: ["105", "110"],
  entryZone: null,
  targets: [],
  invalidation: null,
  trigger: null,
  chartReference: null,
  sourceHandle: "morecryptoonline",
  sourceChannel: null,
  sourceKind: "youtube",
  sourceReliability: null,
  rawThesisText: null,
  collectedAt: null,
  publishedAt: null,
  sourceUrl: null,
  notes: null
};
```

Run:

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
```

Expected: FAIL because `PolicySynthesisSrThesis` and `PolicySynthesisEnvelope.srTheses` do not exist and the reducer ignores the values.

- [ ] **Step 2: Add the synthesis-only SR type and envelope field**

Import `SrThesisV2` from the contract and add the identity-preserving type without changing the v2 wire contract:

```ts
export interface PolicySynthesisSrThesis extends SrThesisV2 {
  readonly source: string;
  readonly briefId: string;
}

export interface PolicySynthesisEnvelope {
  // existing fields stay unchanged
  readonly srTheses?: readonly PolicySynthesisSrThesis[];
}
```

- [ ] **Step 3: Merge SR values into shared rule evaluation**

After evidence-derived feature levels are collected and before conflict evaluation, process `envelope.srTheses ?? []`. Parse price strings with `Number`, accept only `Number.isFinite(value) && value > 0`, increment the existing counters only for exact `bullish`/`bearish` bias values, and add `briefId` to `boundedIdentifiers`:

```ts
for (const thesis of envelope.srTheses ?? []) {
  for (const raw of thesis.supportLevels) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) extractedSupport.push(value);
  }
  for (const raw of thesis.resistanceLevels) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) extractedResistance.push(value);
  }
  if (thesis.bias === "bullish") bullishCount += 1;
  if (thesis.bias === "bearish") bearishCount += 1;
}
```

Add each SR brief identifier once, preserving first occurrence in the canonical thesis order:

```ts
const seenSrBriefIds = new Set<string>();
for (const thesis of envelope.srTheses ?? []) {
  if (!seenSrBriefIds.has(thesis.briefId)) {
    seenSrBriefIds.add(thesis.briefId);
    boundedIdentifiers.push(thesis.briefId);
  }
}
```

Do not add a new action, reason code, warning code, or output field. Reuse the current vote/conflict rules, level sets, ordering, and caps.

- [ ] **Step 4: Run the scoped reducer checks**

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
pnpm exec eslint src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
pnpm exec prettier --check src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
```

Expected: the focused test file passes; ESLint and Prettier exit 0.

- [ ] **Step 5: Commit the reducer slice**

```bash
git add src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
git commit -m "m82: merge SR theses into policy synthesis"
```

## Repository Targets

### Expected Files
- src/engine/policy/synthesizePolicyInsight.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts

### Reference Files
- src/contract/v2/srLevels.ts
- src/engine/policy/__tests__/policyFixtures.ts
- src/engine/policy/reasoning.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
pnpm exec eslint src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
pnpm exec prettier --check src/engine/policy/synthesizePolicyInsight.ts src/engine/policy/__tests__/synthesizePolicyInsight.srTheses.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **SR and evidence level coexistence**: Eligible SR-ledger levels and evidence-derived numeric levels are unioned, while each SR brief identity is retained exactly once in reasoning. (Test: `adds valid SR thesis levels and identities without replacing evidence-derived inputs`)
- **Cross-source directional conflict**: SR thesis bias contributes to the same directional vote totals as contextual evidence, so opposing inputs trigger existing conflict tightening. (Test: `combines SR and evidence bias votes and treats opposition as conflict`)
- **Level eligibility**: Non-finite, non-positive, and wrong-side price levels cannot enter the published support or resistance arrays. (Test: `ignores non-finite non-positive and side-ineligible SR level strings`)
- **Level bounds and ordering**: SR levels use the existing deduplication, nearest-first sorting, and sixteen-value caps. (Test: `deduplicates sorts and caps SR levels with existing output rules`)
- **Reducer determinism**: A fixed envelope containing canonical SR theses produces byte-identical output on repeated reduction. (Test: `produces byte-identical output for the same canonical SR thesis input`)
- **Historical envelope compatibility**: An omitted optional srTheses member behaves exactly like an empty array. (Test: `preserves legacy reducer behavior when SR theses are absent`)

