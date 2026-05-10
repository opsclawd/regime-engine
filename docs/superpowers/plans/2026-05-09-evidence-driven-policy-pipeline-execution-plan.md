# Evidence-Driven Policy Pipeline — Cross-Repo Execution Plan

**Date:** 2026-05-09
**Status:** Approved
**Total issues:** 23 (3 epics + 20 children)

---

## 1. Issue Inventory

### `opsclawd/sol-usdc-clmm-intelligence` — 13 issues (1 epic + 12 children)

| #   | Key                                    | Title                                                                                      |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2   | INT-EPIC                               | epic: restructure intelligence engine into evidence pipeline                               |
| 3   | INT-ARCH                               | refactor: introduce modular evidence-pipeline architecture                                 |
| 4   | INT-REPLACE-LEGACY-CLMM-COLLECTOR      | refactor: replace legacy backend snapshot collector with canonical clmm-v2 bundle consumer |
| 5   | INT-PERSIST                            | feat: add DB-backed observation and artifact persistence                                   |
| 6   | INT-TAXONOMY                           | feat: define signal taxonomy, freshness, and source-quality model                          |
| 7   | INT-CORE                               | feat: ingest core deterministic SOL/USDC source data                                       |
| 8   | INT-FEATURES                           | feat: derive deterministic SOL/USDC evidence features                                      |
| 9   | INT-CONTEXT-A                          | feat: add contextual research collectors pack A                                            |
| 10  | INT-FLOW-B                             | feat: add on-chain flow research collectors pack B                                         |
| 11  | INT-PERP-C                             | feat: add perp and liquidation research collectors pack C                                  |
| 12  | INT-BRIEFS                             | feat: generate schema-constrained research briefs from evidence bundles                    |
| 13  | INT-PUBLISH                            | feat: publish structured evidence bundles to regime-engine                                 |
| 14  | INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS | refactor: remove legacy recommendation artifact flows                                      |

### `opsclawd/regime-engine` — 7 issues (1 epic + 6 children)

| #   | Key                             | Title                                                                     |
| --- | ------------------------------- | ------------------------------------------------------------------------- |
| 57  | RE-EPIC                         | epic: synthesize policy insights from external research evidence          |
| 58  | RE-CONTRACT                     | feat: define research evidence contract and persistence model             |
| 59  | RE-INGEST                       | feat: add authenticated research-evidence ingest and query endpoints      |
| 60  | RE-EVIDENCE-SELECTION           | feat: select and score fresh research evidence for synthesis              |
| 61  | RE-SYNTHESIS                    | feat: synthesize PolicyInsights from market regime plus research evidence |
| 62  | RE-REMOVE-LEGACY-INSIGHT-INGEST | refactor: remove external final-policy ingest route                       |
| 63  | RE-WIRE-CONTRACT                | fix: normalize PolicyInsights wire contract for clmm-v2 consumers         |

### `opsclawd/clmm-v2` — 3 issues (all children of #90)

| #   | Key            | Title                                                                          |
| --- | -------------- | ------------------------------------------------------------------------------ |
| 91  | CLMM-RAW-FACTS | feat: extend SOL/USDC intelligence bundle with missing raw LP facts            |
| 92  | CLMM-CONTRACT  | fix: align PolicyInsights adapter and DTOs with regime-engine canonical output |
| 93  | CLMM-UI        | feat: render synthesized PolicyInsights with freshness and evidence context    |

---

## 2. Dependency Graph

```text
Phase 1 — Architecture & contracts
  INT-ARCH (no deps)
  INT-REPLACE-LEGACY-CLMM-COLLECTOR (← INT-ARCH, blocks INT-CORE)
  INT-PERSIST (← INT-ARCH)
  INT-TAXONOMY (← INT-ARCH, INT-PERSIST)
  RE-CONTRACT (no deps) → produces JSON Schema, valid/invalid fixtures
  CLMM-RAW-FACTS audit (starts after INT-TAXONOMY)

Phase 2 — Data spine
  INT-CORE (← INT-ARCH, INT-PERSIST, INT-TAXONOMY, INT-REPLACE-LEGACY-CLMM-COLLECTOR)
  INT-FEATURES (← INT-CORE, INT-TAXONOMY)
  RE-INGEST (← RE-CONTRACT)
  CLMM-RAW-FACTS impl (← INT-FEATURES; RE-CONTRACT = reference only)

Phase 3 — Richer evidence
  INT-CONTEXT-A (← INT-ARCH, INT-PERSIST, INT-TAXONOMY)
  INT-FLOW-B (← INT-ARCH, INT-PERSIST, INT-TAXONOMY)
  INT-PERP-C (← INT-ARCH, INT-PERSIST, INT-TAXONOMY)
  INT-BRIEFS (← INT-FEATURES, INT-CONTEXT-A, INT-FLOW-B, INT-PERP-C)
  RE-EVIDENCE-SELECTION (← RE-INGEST)

Phase 4 — End-to-end synthesis
  INT-PUBLISH (← INT-BRIEFS, RE-CONTRACT, RE-INGEST)
  RE-SYNTHESIS (← RE-EVIDENCE-SELECTION)
  RE-REMOVE-LEGACY-INSIGHT-INGEST (← RE-SYNTHESIS)
  RE-WIRE-CONTRACT (← RE-SYNTHESIS)
  INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS (← INT-BRIEFS, RE-SYNTHESIS)

Phase 5 — Consumption
  CLMM-CONTRACT (← RE-WIRE-CONTRACT + RE-CONTRACT shared artifacts)
  CLMM-UI (← CLMM-CONTRACT, RE-SYNTHESIS)
```

---

## 3. Phase Breakdown

### Phase 1 — Architecture and Contracts

Issues establishing the structural foundation and cross-repo contracts.

| Order | Key                               | Repo          | Description                                                             |
| ----- | --------------------------------- | ------------- | ----------------------------------------------------------------------- |
| 1     | INT-ARCH                          | intelligence  | Introduce modular layered `src/` structure                              |
| 2     | INT-REPLACE-LEGACY-CLMM-COLLECTOR | intelligence  | Replace legacy backend collector with canonical clmm-v2 bundle consumer |
| 3     | INT-PERSIST                       | intelligence  | Add DB-backed observation and artifact persistence                      |
| 4     | INT-TAXONOMY                      | intelligence  | Define signal taxonomy, freshness, source-quality model                 |
| 5     | RE-CONTRACT                       | regime-engine | Define evidence contract + persistence + machine-readable artifacts     |
| —     | CLMM-RAW-FACTS audit              | clmm-v2       | Gap audit can start (implementation deferred to Phase 2)                |

**Gate:** INT-ARCH, INT-PERSIST, INT-TAXONOMY, RE-CONTRACT all complete.

### Phase 2 — Data Spine

Core ingestion and deterministic feature derivation.

| Order | Key            | Repo          | Description                                       |
| ----- | -------------- | ------------- | ------------------------------------------------- |
| 6     | INT-CORE       | intelligence  | Ingest core deterministic SOL/USDC source data    |
| 7     | INT-FEATURES   | intelligence  | Derive deterministic evidence features            |
| 8     | RE-INGEST      | regime-engine | Add authenticated evidence ingest/query endpoints |
| 9     | CLMM-RAW-FACTS | clmm-v2       | Extend bundle with missing raw LP facts           |

**Gate:** INT-CORE, INT-FEATURES, RE-INGEST complete.

### Phase 3 — Richer Evidence

Research collector packs and LLM summarization pipeline.

| Order | Key                   | Repo          | Description                                                              |
| ----- | --------------------- | ------------- | ------------------------------------------------------------------------ |
| 10    | INT-CONTEXT-A         | intelligence  | Contextual research collectors pack A (S/R, macro, protocol, event risk) |
| 11    | INT-FLOW-B            | intelligence  | On-chain flow research collectors pack B                                 |
| 12    | INT-PERP-C            | intelligence  | Perp/liquidation research collectors pack C                              |
| 13    | INT-BRIEFS            | intelligence  | Generate schema-constrained LLM research briefs                          |
| 14    | RE-EVIDENCE-SELECTION | regime-engine | Select and score fresh evidence for synthesis                            |

**Gate:** INT-BRIEFS, RE-EVIDENCE-SELECTION complete.

### Phase 4 — End-to-End Synthesis

The pipeline goes live. Evidence flows from intelligence to regime-engine; regime-engine synthesizes final policy.

| Order | Key                                    | Repo          | Description                                             |
| ----- | -------------------------------------- | ------------- | ------------------------------------------------------- |
| 15    | INT-PUBLISH                            | intelligence  | Publish evidence bundles to regime-engine               |
| 16    | RE-SYNTHESIS                           | regime-engine | Synthesize PolicyInsights from market regime + evidence |
| 17    | RE-REMOVE-LEGACY-INSIGHT-INGEST        | regime-engine | Remove POST /v1/insights/sol-usdc                       |
| 18    | RE-WIRE-CONTRACT                       | regime-engine | Normalize PolicyInsights wire contract                  |
| 19    | INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS | intelligence  | Remove legacy recommendation artifact flows             |

**Gate:** INT-PUBLISH and RE-SYNTHESIS both live. Old external POST route removed. Recommendation flows removed.

### Phase 5 — Consumption

clmm-v2 aligns with the canonical contract and renders the final output.

| Order | Key           | Repo    | Description                                               |
| ----- | ------------- | ------- | --------------------------------------------------------- |
| 20    | CLMM-CONTRACT | clmm-v2 | Align DTOs + eliminate duplicated validation              |
| 21    | CLMM-UI       | clmm-v2 | Render PolicyInsights with freshness and evidence context |

**Gate:** RE-WIRE-CONTRACT complete. CLMM-CONTRACT and CLMM-UI deployed.

---

## 4. Sequencing Decisions

### Why INT-REPLACE-LEGACY-CLMM-COLLECTOR Lands in Phase 1

The legacy `/api/clmm/sol-usdc/*` collector is the data seam that INT-CORE would otherwise build on. Replacing it before INT-CORE prevents building new architecture on top of old data plumbing.

### Why INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS Lands in Phase 4

The old recommendation flows (daily insight, range review, rebalance, weekly review) are the parallel policy brain that must be removed — but only **after** the replacement path is proven.

**Rule:** `INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS` lands only after both `INT-PUBLISH` (#13) and `RE-SYNTHESIS` (#61) are live. The new evidence-bundle → synthesis path must be the canonical output before the old recommendation generators are deleted.

### Why RE-REMOVE-LEGACY-INSIGHT-INGEST Lands in Phase 4

The old `POST /v1/insights/sol-usdc` endpoint is the external final-policy write surface. It is removed in the same release cycle as RE-SYNTHESIS — not carried as deprecated debt.

**Rule:** `RE-REMOVE-LEGACY-INSIGHT-INGEST` removes the old external POST write surface, **not** the final-policy read surface (`GET /v1/insights/sol-usdc/current` and `GET /v1/insights/sol-usdc/history` are preserved).

### Why INT-PUBLISH Uses Parallel Development

INT-PUBLISH depends on RE-CONTRACT and RE-INGEST for production integration, but implementation can proceed in parallel using:

- Contract-level fixtures (JSON Schema, examples from RE-CONTRACT)
- A local stub server generated from RE-CONTRACT's machine-readable artifacts

This prevents the exact cross-repo contract drift that previously occurred.

### Why CLMM-RAW-FACTS Has a Split Audit/Implement Timeline

- **Audit** starts after INT-TAXONOMY (to know which evidence families need raw LP inputs)
- **Implementation** finalizes after INT-FEATURES (features shape the specific raw facts needed)
- RE-CONTRACT is a reference dependency only — the bundle shape is driven by evidence feature needs, not by the downstream evidence wire contract

---

## 5. Rollout / Cutover Order

1. **Phases 1-3:** Build the pipeline in isolation. intelligence repo produces evidence bundles internally; regime-engine registers endpoints but receives no live evidence yet. clmm-v2 bundle is extended.

2. **Phase 4 cutover:** INT-PUBLISH starts sending live evidence to RE-INGEST. RE-SYNTHESIS produces the first internally-synthesized PolicyInsights. The old POST route is removed in the same deploy cycle. The old recommendation generators are disabled.

3. **Phase 5 consumption:** clmm-v2 consumes the canonical PolicyInsight contract. Old field-name drift is resolved. UI shows the new synthesized output.

**During cutover:** The GET /v1/insights/sol-usdc/current surface remains stable throughout. clmm-v2 clients see no read-path disruption. Only the write path changes (external → internal).

---

## 6. Tech-Debt Removals

| Debt                                    | Removed In                                   | Method                                           |
| --------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Legacy `/api/clmm/sol-usdc/*` collector | INT-REPLACE-LEGACY-CLMM-COLLECTOR (#4)       | Replace with canonical clmm-v2 bundle consumer   |
| Legacy recommendation flows             | INT-REMOVE-LEGACY-RECOMMENDATION-FLOWS (#14) | Remove generators, CLI entrypoints, cron configs |
| External final-policy POST route        | RE-REMOVE-LEGACY-INSIGHT-INGEST (#62)        | Delete route, auth surface, docs, tests          |
| PolicyInsights field-name drift         | RE-WIRE-CONTRACT (#63) + CLMM-CONTRACT (#92) | Normalize contract; consume shared artifacts     |
| Duplicated validation across BFF/app    | CLMM-CONTRACT (#92)                          | Centralize parser in one shared module           |

---

## 7. Verification Gates

Each phase has a verification gate that must pass before the next phase starts:

| Gate                       | Phase     | Check                                                                                                                                                                               |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture complete      | End of P1 | INT-ARCH produces working layered structure; INT-REPLACE-LEGACY-CLMM-COLLECTOR data flowing; INT-PERSIST migrations run; INT-TAXONOMY types stable; RE-CONTRACT artifacts published |
| Data spine complete        | End of P2 | INT-CORE ingests from all required sources; INT-FEATURES produces correct deterministic metrics; RE-INGEST accepts and stores evidence; CLMM-RAW-FACTS gap closed                   |
| Evidence pipeline complete | End of P3 | All collector packs producing data; INT-BRIEFS output valid; RE-EVIDENCE-SELECTION correctly scores and filters evidence                                                            |
| Synthesis live             | End of P4 | INT-PUBLISH sends evidence to RE-INGEST; RE-SYNTHESIS produces PolicyInsights; old POST route removed; old recommendation flows removed                                             |
| Consumption live           | End of P5 | CLMM-CONTRACT parses canonical contract without drift; CLMM-UI renders synthesized insights correctly                                                                               |

---

## 8. Reference

- **Design spec:** `docs/superpowers/specs/2026-05-09-evidence-driven-policy-pipeline-design.md` (canonical architecture source of truth)
- **This document:** `docs/superpowers/plans/2026-05-09-evidence-driven-policy-pipeline-execution-plan.md` (canonical delivery roadmap)
