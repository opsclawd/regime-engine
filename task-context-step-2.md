# Task Context: Task 2

Title: Read, canonicalize, hash, and wire Postgres SR theses
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

- Create: `src/application/ports/srThesesReadPort.ts`
- Modify: `src/ledger/srThesesV2Store.ts`
- Modify: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/policyInsightFingerprints.ts`
- Modify: `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- Create: `src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts`
- Modify: `src/composition/buildApplication.ts`
- Modify: `src/composition/__tests__/policyInsightWiring.test.ts`
- Reference: `src/contract/v2/srLevels.ts`
- Reference: `src/composition/buildStoreContext.ts`
- Reference: `src/engine/policy/synthesizePolicyInsight.ts`
- Reference: `.dependency-cruiser.cjs`

This task intentionally contains the new read-port method, the concrete Postgres implementation declaration, and the composition update together. Do not split them: the workspace-wide typecheck gate must see a complete vertical slice.

**Behavioral invariants (write these named tests first):**

1. `queries the primary mco SR brief for SOL USDC before fingerprint lookup`
   - The use case calls `getCurrent("SOL/USDC", "mco")` exactly once before `findBySynthesisInputHash` and persists the returned brief projection.
2. `canonicalizes SR theses by source brief asset and source handle`
   - Two current responses with identical theses in different database-return order produce the same persisted `srTheses` order and the same synthesis input hash.
3. `treats a missing current SR brief as a canonical empty input`
   - A `null` read yields `srTheses: []`, still synthesizes, and includes the empty input in the fingerprint.
4. `changes synthesis replay identity when SR thesis content changes`
   - With market, plan, and evidence unchanged, changing levels, bias, identity, or other thesis content changes `synthesisInputHash` and creates distinct history.
5. `exact SR replay returns the stored canonical winner`
   - The same canonical SR input reuses the existing policy record, just like existing market/position/evidence replay.
6. `does not persist or replay when the SR store read fails`
   - A rejected `getCurrent` promise propagates; neither repository read nor insert is called, preventing a database outage from being silently interpreted as no SR data.
7. `requires the Postgres SR reader before exposing synthesis capability`
   - `buildApplication` returns `synthesizePolicyInsight: null` when Postgres/evidence are present but `srThesesV2Store` is absent, and returns a function when all are present.

- [ ] **Step 1: Add failing focused use-case and wiring tests**

Create a small fake `SrThesesReadPort` and repository in the new test file. Assert call order with a shared event array, inspect `repository.insertCalls[0].synthesisInputJson.srTheses`, and compare `insightId`/`synthesisInputHash` across reordered and changed briefs. Update the existing 643-line use-case test only mechanically by injecting an empty reader into every factory call:

```ts
const emptySrThesesReadPort = (): SrThesesReadPort => ({
  getCurrent: vi.fn().mockResolvedValue(null)
});

const useCase = createSynthesizePolicyInsightUseCase({
  getCurrentRegime,
  selectEvidence,
  srThesesReadPort: emptySrThesesReadPort(),
  repository,
  clock,
  ruleset: SOL_USDC_POLICY_V1
});
```

In `policyInsightWiring.test.ts`, use a structural fake with `getCurrent: vi.fn().mockResolvedValue(null)` for the positive case and retain `null` for the negative case.

Run:

```bash
pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/composition/__tests__/policyInsightWiring.test.ts
```

Expected: FAIL until the port, dependency, fingerprint, and composition changes exist.

- [ ] **Step 2: Add the application read port and declare the adapter implementation**

Create the boundary type using the existing contract response:

```ts
import type { SrLevelsV2CurrentResponse } from "../../contract/v2/srLevels.js";

export interface SrThesesReadPort {
  getCurrent(symbol: string, source: string): Promise<SrLevelsV2CurrentResponse | null>;
}
```

Update `SrThesesV2Store` to `implements SrThesesReadPort` and import the port type. Do not alter its method body, SQL ordering, return contract, or error behavior.

- [ ] **Step 3: Canonically project current-response identity into synthesis theses**

Add the required `srThesesReadPort` member to `SynthesizePolicyInsightUseCaseDeps`. In the use-case module, add a private projection that enriches every thesis and sorts a copied array without mutating the store response:

```ts
const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const projectSrTheses = (current: SrLevelsV2CurrentResponse | null): PolicySynthesisSrThesis[] =>
  current === null
    ? []
    : current.theses
        .map((thesis) => ({
          ...thesis,
          source: current.source,
          briefId: current.brief.briefId
        }))
        .sort(
          (left, right) =>
            compareText(left.source, right.source) ||
            compareText(left.briefId, right.briefId) ||
            compareText(left.asset, right.asset) ||
            compareText(left.sourceHandle, right.sourceHandle)
        );
```

After evidence selection/time/hash validation and before computing fingerprints or querying the policy repository, call:

```ts
const srTheses = projectSrTheses(await deps.srThesesReadPort.getCurrent("SOL/USDC", "mco"));
```

Do not catch this read as an empty response. Pass `srTheses` to both fingerprint computation and the persisted envelope.

- [ ] **Step 4: Include canonical SR content in replay identity**

Add a required `srTheses: readonly PolicySynthesisSrThesis[]` member to `FingerprintsInput`. Compute a component hash and add it to the canonical `inputForHash` object:

```ts
const srThesesHash = sha256Hex(toCanonicalJson(input.srTheses));

const inputForHash = {
  rulesetVersion: input.rulesetVersion,
  pair: input.pair,
  scopeKey,
  marketHash,
  positionHash,
  selectionHash,
  srThesesHash
};
```

No database column or `PolicyInsightFingerprints` return member is needed: `synthesisInputHash` remains the persisted aggregate identity.

- [ ] **Step 5: Wire the port and preserve capability truthfulness**

In `buildApplication`, require `ctx.srThesesV2Store` in the same condition that currently requires the policy and evidence repositories, then pass it as `srThesesReadPort`. Because `buildStoreContext` constructs that store from the same `Db`, both the HTTP lifecycle worker and standalone worker receive a Postgres-backed reader; no SQLite `/data` path is consulted for SR.

```ts
const synthesizePolicyInsight =
  policyInsightRepository && selectEvidenceForSynthesis && ctx.srThesesV2Store
    ? createSynthesizePolicyInsightUseCase({
        getCurrentRegime,
        selectEvidence: selectEvidenceForSynthesis,
        srThesesReadPort: ctx.srThesesV2Store,
        repository: policyInsightRepository,
        clock,
        ruleset: SOL_USDC_POLICY_V1
      })
    : null;
```

- [ ] **Step 6: Run the scoped vertical-slice checks**

```bash
pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/composition/__tests__/policyInsightWiring.test.ts
pnpm exec eslint src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
pnpm exec prettier --check src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
```

Expected: all three test files pass; ESLint and Prettier exit 0. The automatic implementation gate then runs `pnpm -r typecheck` workspace-wide with the port and adapter already aligned.

- [ ] **Step 7: Commit the vertical slice**

```bash
git add src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
git commit -m "m82: read Postgres SR theses during policy synthesis"
```

## Repository Targets

### Expected Files
- src/application/ports/srThesesReadPort.ts
- src/ledger/srThesesV2Store.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts
- src/application/use-cases/policyInsightFingerprints.ts
- src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts
- src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts
- src/composition/buildApplication.ts
- src/composition/__tests__/policyInsightWiring.test.ts

### Reference Files
- src/contract/v2/srLevels.ts
- src/composition/buildStoreContext.ts
- src/engine/policy/synthesizePolicyInsight.ts
- .dependency-cruiser.cjs

## Validation Commands

```bash
pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/composition/__tests__/policyInsightWiring.test.ts
pnpm exec eslint src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
pnpm exec prettier --check src/application/ports/srThesesReadPort.ts src/ledger/srThesesV2Store.ts src/application/use-cases/synthesizePolicyInsightUseCase.ts src/application/use-cases/policyInsightFingerprints.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightSrTheses.test.ts src/composition/buildApplication.ts src/composition/__tests__/policyInsightWiring.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **Primary source lookup ordering**: The use case reads SOL/USDC from source mco exactly once before any replay lookup or persistence. (Test: `queries the primary mco SR brief for SOL USDC before fingerprint lookup`)
- **Canonical thesis ordering**: Database return order cannot affect persisted thesis order or synthesis input identity. (Test: `canonicalizes SR theses by source brief asset and source handle`)
- **Explicit no-data input**: A successful null current read becomes a canonical empty srTheses array and does not block synthesis. (Test: `treats a missing current SR brief as a canonical empty input`)
- **SR-sensitive replay identity**: Changing SR thesis content while other synthesis inputs remain fixed produces a new synthesis input hash. (Test: `changes synthesis replay identity when SR thesis content changes`)
- **Exact SR replay**: Equivalent canonical SR input reuses the existing stored winner instead of creating duplicate history. (Test: `exact SR replay returns the stored canonical winner`)
- **Read failure is not absence**: A rejected SR database read propagates before repository lookup or insert and is never converted to an empty input. (Test: `does not persist or replay when the SR store read fails`)
- **Truthful composition capability**: Synthesis is exposed only when Postgres policy, evidence, and SR read dependencies are all available. (Test: `requires the Postgres SR reader before exposing synthesis capability`)

