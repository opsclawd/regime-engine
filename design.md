# Design: Wire PolicyInsight synthesis to real support/resistance data

## The problem being solved and why it matters

Currently, the `synthesizePolicyInsightUseCase` relies on evidence-bundle context for Support/Resistance data (`ctx.supportResistance`), but the intelligence collector responsible for that data is broken. Meanwhile, real TA-driven SR data (e.g., from `mco`) is successfully ingested via a `/v1/sr-levels` endpoint. However, this v1 data is stored in a local SQLite ledger, which the `regime-engine-synthesis-worker` cannot read due to its deployment on an isolated Railway volume.

A v2 endpoint (`/v2/sr-levels`) backed by Postgres exists, which the synthesis worker _can_ read, but no data is currently pushed to it and the synthesizer does not query it. This matters because our policy engine lacks critical real-world support and resistance levels, significantly limiting the accuracy and effectiveness of the trading policy generation.

## Key design decisions and trade-offs considered

- **Dependency Injection vs. Direct Store Access:** We could pass `SrThesesV2Store` directly into `createSynthesizePolicyInsightUseCase`, or we could create a dedicated `GetCurrentSrThesesUseCase`. We will pass `srThesesV2Store` (or a lightweight read port) directly in `buildApplication.ts`. This avoids over-engineering a use-case for a simple cross-service DB read, keeping changes concise.
- **Data Integration in the Synthesizer:** The v2 store has rich data (arrays of `supportLevels` and `resistanceLevels`, plus `bias`). We could shoehorn this into the existing `ContextualEvidence` format, but that risks losing data fidelity. Instead, we will add a new top-level field `srTheses: SrThesisV2[]` to the `PolicySynthesisEnvelope` and process it natively in `synthesizePolicyInsight.ts`.
- **Handling the `source` parameter:** `srThesesV2Store.getCurrent(symbol, source)` requires a source string. We will query for a configured primary source (e.g., `"mco"`), but architect the envelope so that multiple sources could easily be appended in the future.

## Proposed approach with rationale

1. **Producer Integration (External):** Ensure the `crypto-aggregator` agent POSTs its data to `/v2/sr-levels` to land in Postgres. (Out of repo scope).
2. **App Composition:** In `buildApplication.ts`, pass `ctx.srThesesV2Store` to the `createSynthesizePolicyInsightUseCase` dependencies.
3. **Use Case Modification:** Update `synthesizePolicyInsightUseCase.ts` to query `srThesesV2Store.getCurrent(pair, "mco")`. We will extract the `.theses` array from the response.
4. **Envelope Update:** Add `srTheses?: SrThesisV2[]` to `PolicySynthesisEnvelope`.
5. **Synthesis Engine:** In `evaluateSharedRules` (inside `synthesizePolicyInsight.ts`), iterate over `envelope.srTheses`.
   - Add all `supportLevels` to `extractedSupport`.
   - Add all `resistanceLevels` to `extractedResistance`.
   - Map `bias === "bullish"` to increment `bullishCount` and `bias === "bearish"` to increment `bearishCount`.
   - Ensure the bounded identifiers from the theses (e.g. `briefId`) are added to `boundedIdentifiers`.
6. **Coexistence:** This new path operates independently of the evidence-bundle `ctx.supportResistance`. When the bundle collector is fixed, both sources will add to the extracted levels natively without conflict.

## Assumptions made

- The primary source identifier for the SR data is `"mco"`, which will be used when querying `srThesesV2Store.getCurrent`.
- The Postgres v2 table (`regime_engine.sr_theses_v2`) is accessible by the synthesis worker's DB credentials and correctly migrated.
- Adding the theses' levels directly to `extractedSupport` and `extractedResistance` is semantically correct and properly integrates with the downstream `supportSet` and `resistanceSet` trimming logic (which expects non-zero positive numbers).
- Adding `srTheses` to `PolicySynthesisEnvelope` will naturally be included in the canonical JSON hashing if we ensure the array is sorted and deterministic.

## What is in scope and what is explicitly out of scope

- **In scope:**
  - Modifying `buildApplication.ts`, `synthesizePolicyInsightUseCase.ts`, and `synthesizePolicyInsight.ts`.
  - Passing `srThesesV2Store` into the use case and retrieving Postgres-backed SR data.
  - Updating the `PolicySynthesisEnvelope` type and canonicalization.
  - Adding test coverage for this new deterministic input.
- **Out of scope:**
  - Fixing the broken `sol-usdc-clmm-intelligence` collector.
  - Updating the `crypto-aggregator` producer to point to `/v2/sr-levels` (this requires a companion issue in that repo).
  - Removing or migrating the existing v1 SQLite SR storage mechanisms.

## Any risks or concerns identified from code analysis

- **Determinism:** The `synthesisInputHash` relies on the `envelope` being byte-for-byte deterministic. When adding `srTheses` to the envelope, we must ensure they are canonically sorted (e.g., by `sourceHandle` or `asset`) before hashing, otherwise the policy insight fingerprint tests will fail and produce non-deterministic artifacts.
- **Source Hardcoding:** Querying specifically for `"mco"` could become a bottleneck if additional sources (e.g., `"internal_quant"`) are added later. We may need to update the store to allow fetching the latest brief across _all_ sources if this becomes a requirement.
