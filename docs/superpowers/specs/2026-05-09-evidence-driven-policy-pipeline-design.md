# Evidence-Driven Policy Pipeline — Cross-Repo Architecture

**Date:** 2026-05-09
**Status:** Approved
**Owner:** Regime Engine (canonical policy synthesis authority)

---

## 1. Why the Old Architecture Is Wrong

### 1.1 Intelligence Engine Publishing Final `PolicyInsights`

The original design had the intelligence repo (`sol-usdc-clmm-intelligence`) publishing final, user-facing `PolicyInsights` directly to Regime Engine. This conflated two concerns:

- **Evidence gathering** (observation, normalization, derivation, summarization) — a data and ML concern
- **Policy synthesis** (regime classification, risk assessment, action recommendation) — a domain and rules concern

The intelligence repo has no business knowing the full policy model — it does not own the regime classifier, the plan engine, or the hard safety guards. Publishing final policy from the intelligence layer meant the LLM prompt implicitly became the policy authority, with no deterministic guard layer between raw evidence and user recommendations.

### 1.2 Regime Engine Acting as a Mailbox

The original `POST /v1/insights/sol-usdc` endpoint made Regime Engine a passive mailbox. It accepted already-synthesized `PolicyInsight` payloads, stored them, and served them on read — but contributed no synthesis logic. The regime classifier, plan engine, and deterministic market state were effectively decoupled from the final user-facing recommendation.

This created:

- No single authority for policy — both repos could plausibly claim ownership
- No guard layer between LLM output and user action recommendations
- A fragile contract: field name drift (`maxCapitalDeploymentPercent` vs `maxCapitalDeploymentPct`) was inevitable because no single repo owned the canonical shape
- Testing blind spots: the final recommendation path was never exercised end-to-end within one repo

---

## 2. Corrected Architecture

### 2.1 Repo Ownership Boundaries

```
clmm-v2
  OWNS: live LP positions, wallet state, execution authority, pool-level raw facts
  OWNS: final PolicyInsight display/consumption
  EXPOSES: read-only /insights/sol-usdc/* bundle for intelligence consumers
  DOES NOT OWN: evidence collection, policy synthesis, regime classification

sol-usdc-clmm-intelligence
  OWNS: raw observation collection, normalization, deterministic feature derivation
  OWNS: contextual research collection (macro, on-chain, perp)
  OWNS: LLM research brief generation over bounded evidence
  OWNS: evidence bundle publication to Regime Engine
  DOES NOT OWN: final policy decisions, wallet access, execution authority
  DOES NOT OWN: the canonical PolicyInsight shape

regime-engine
  OWNS: deterministic market regime classification and candle-based analysis
  OWNS: plan generation and CLMM suitability assessment
  OWNS: evidence ingest, scoring, selection
  OWNS: PolicyInsight synthesis — fusing regime + evidence into the one canonical output
  OWNS: the canonical PolicyInsight wire contract
  EXPOSES: GET /v1/insights/sol-usdc/current and /history for clmm-v2
  DOES NOT OWN: raw evidence collection, LLM research, wallet execution
```

### 2.2 Data Flow

```
clmm-v2 ──(/insights/sol-usdc/*)──┐
                                    ├──> sol-usdc-clmm-intelligence
Pyth/Orca/Jupiter ──(raw feeds)────┘         │
                                              │ collect + normalize + derive
                                              │ generate LLM research briefs
                                              │ assemble evidence bundles
                                              v
                                    POST /v1/evidence/sol-usdc
                                              │
                                              v
                                    regime-engine
                                              │ select + score fresh evidence
                                              │ fuse with deterministic market state
                                              │ synthesize canonical PolicyInsight
                                              v
                                    GET /v1/insights/sol-usdc/current
                                              │
                                              v
                                    clmm-v2 ── render PolicyInsight in UI
```

---

## 3. End-to-End Data Lifecycle

### Stage 1: Raw Observations

Unprocessed source responses captured at fetch time. Includes source metadata, content hash, parse status. Immutable — never modified after storage.

**Owned by:** intelligence repo
**Persistence:** `intelligence.raw_observations` (append-only, retention-tiered)

### Stage 2: Normalized Observations

Parsed, validated, and structured representations of raw source data. Each normalized record links back to its raw observation. Uses the canonical signal taxonomy (signal class, evidence family, freshness, confidence, provenance).

**Owned by:** intelligence repo
**Persistence:** `intelligence.normalized_observations`

### Stage 3: Derived Deterministic Features

Code-computed numerical metrics over normalized observations. Never generated by LLM. Includes: oracle divergence, fee APR, realized volatility, inventory skew, volume/liquidity ratio, breach-risk indicators.

**Owned by:** intelligence repo
**Persistence:** `intelligence.derived_features` (with input lineage back to normalized observations)

### Stage 4: Contextual Evidence

Lower-confidence signals from research collectors: support/resistance theses, macro calendar events, protocol incidents, on-chain flow observations, perp funding/liquidation data. Explicitly marked as lower-confidence than deterministic features.

**Owned by:** intelligence repo
**Persistence:** `intelligence.normalized_observations` with contextual signal class

### Stage 5: Research Briefs

LLM-generated summaries over bounded, structured evidence bundles. Schema-constrained output only — the LLM summarizes and contextualizes but never invents deterministic metrics or makes final policy decisions. Includes prompt version, model/provider metadata, confidence, and source refs.

**Owned by:** intelligence repo
**Persistence:** `intelligence.research_briefs`

### Stage 6: Evidence Bundles

Assembled payloads containing deterministic feature summaries, contextual evidence summaries, and LLM research briefs. Published to Regime Engine. This is the final intelligence repo output — it goes no further in the intelligence layer.

**Owned by:** intelligence repo (assembly and publication)
**Persisted in:** `intelligence.evidence_bundles`

### Stage 7: Selected Evidence

Regime Engine's internal scoring/selection layer. Reads current valid evidence, rejects stale/expired entries, exposes missing-family warnings, and produces a synthesis-ready evidence summary.

**Owned by:** regime-engine
**Not externally exposed**

### Stage 8: Synthesized PolicyInsights

The one canonical output: market regime + fundamental regime + recommended action + confidence + risk level + clmmPolicy + levels + reasoning + sourceRefs. Generated internally by Regime Engine from deterministic market state + selected evidence.

**Owned by:** regime-engine
**Exposed via:** `GET /v1/insights/sol-usdc/current` and `/history`

---

## 4. Evidence Precedence Rule

When evidence sources conflict, the following precedence applies:

```
Deterministic hard guards (stale-data blocks, safety limits)
  > Deterministic evidence (oracle divergence, volatility, fee APR)
    > Contextual / LLM evidence (news, macro, on-chain flow, research briefs)
```

- A deterministic hard guard — such as "no data fresher than 90 minutes" — always wins. Research evidence cannot override it.
- Deterministic evidence (code-computed numerical metrics) can modulate posture, confidence, and risk.
- Contextual and LLM evidence can further modulate posture but only within bounds set by deterministic evidence.
- The synthesis layer records which evidence was used, which was ignored, and why.

---

## 5. API / Resource Model

### New Endpoint (Evidence Ingest)

```
POST /v1/evidence/sol-usdc
  Auth:      token-guarded (intelligence repo caller)
  Body:      structured evidence bundle (see evidence contract)
  Success:   201 Created / 200 Already Ingestion (idempotent)
  Conflict:  409 (same runId, different payload)
  Failure:   503 (store unavailable)

GET /v1/evidence/sol-usdc/current
  Returns:   current valid evidence with freshness/stale status
  Note:      internal/observability route, not the clmm-v2 consumption path

GET /v1/evidence/sol-usdc/history
  Returns:   bounded evidence history
  Note:      internal/observability route
```

### Retained Endpoints (Final Policy Read)

```
GET /v1/insights/sol-usdc/current
  Returns:   canonical PolicyInsight (synthesized internally)
  Consumer:  clmm-v2

GET /v1/insights/sol-usdc/history
  Returns:   bounded PolicyInsight history
  Consumer:  clmm-v2
```

### Removed Endpoint

```
POST /v1/insights/sol-usdc  →  DELETED
  Removed because: final PolicyInsights are now synthesized internally.
  No external caller can create final policy via HTTP.
  The read surface (GET) is unaffected.
```

### Current clmm-v2 Bundle Surface

```
GET /insights/sol-usdc/*
  Consumer:  intelligence repo (replaces legacy /api/clmm/sol-usdc/* collector)
  Content:   raw LP facts, pool state, position state, alerts, S/R context
  Note:      extended by CLMM-RAW-FACTS (#91) with missing raw LP facts
```

### Hard Path Isolation

The evidence ingest path and the final policy read path are **different resources with different semantics**:

| Resource             | Path                                | Semantics                            |
| -------------------- | ----------------------------------- | ------------------------------------ |
| Research evidence    | `POST /v1/evidence/sol-usdc`        | Write — intelligence → regime-engine |
| Final policy insight | `GET /v1/insights/sol-usdc/current` | Read — regime-engine → clmm-v2       |

These must never share a path, be overloaded, or be combined into a single endpoint.

---

## 6. Machine-Readable Contract Strategy

To prevent the exact cross-repo contract drift that existed between regime-engine and clmm-v2 (field name mismatches, unit ambiguity), every cross-repo contract must produce machine-readable artifacts:

| Artifact                 | Purpose                                        | Consumer                   |
| ------------------------ | ---------------------------------------------- | -------------------------- |
| Canonical JSON Schema    | Single source of truth for wire shape          | All repos                  |
| Valid example payload    | Development fixture, contract tests            | INT-PUBLISH, CLMM-CONTRACT |
| Invalid example payloads | Negative contract tests                        | CLMM-CONTRACT              |
| Shared fixture set       | Published or linked for cross-repo consumption | INT-PUBLISH, CLMM-CONTRACT |

**Owned by:** RE-CONTRACT (#58) for the evidence contract; RE-WIRE-CONTRACT (#63) for the final PolicyInsight contract.

**Distribution:** Artifacts are checked into the regime-engine repo and referenced by URL from intelligence and clmm-v2 issue bodies. If a shared package/published artifact mechanism is available, prefer that; otherwise, a well-known path and explicit version tag suffices.

---

## 7. Migration and Removal Decisions

### 7.1 Replace Legacy Intelligence Backend Collector

The intelligence repo currently has a collector targeting legacy `/api/clmm/sol-usdc/*` paths. This must be replaced with one canonical consumer of clmm-v2's current `/insights/sol-usdc/*` bundle surface.

**Why:** Two semantically different data paths for the same CLMM data create drift, confusion, and maintenance burden.

**When:** Phase 1, before INT-CORE. Do not build new ingestion on old seams.

### 7.2 Remove Legacy Intelligence Recommendation Flows

The intelligence repo produces daily insight, range review, rebalance recommendation, and weekly review outputs that behave as a second policy brain. These must be removed.

**Rule:** Removal happens only after both INT-PUBLISH (#13) and RE-SYNTHESIS (#61) are live. The new evidence-bundle path must be the canonical output before the old recommendation path is deleted.

### 7.3 Remove External Final-Policy Ingest

`POST /v1/insights/sol-usdc` is removed entirely — not deprecated, not shimmed, not carried as debt.

**Rule:** Removed in the same cycle as RE-SYNTHESIS (#61). The POST write surface is deleted; the GET read surface is preserved.

### 7.4 Normalize PolicyInsights Wire Contract

Resolve the known field-name and unit mismatches between regime-engine output and clmm-v2 expectations. Choose one canonical wire shape and enforce it with contract tests.

---

## 8. Deferred Decisions

- **MCO-specific S/R level v1/v2 consolidation:** Intentionally deferred. The current S/R surface works for both regimes; consolidation is a separate concern.
- **Weekly-report candle-store fix:** Handled by existing regime-engine issue #55. Not part of this pipeline.
- **Multi-pair support:** The pipeline is SOL/USDC-only in this iteration. Evidence taxonomy supports future pairs but no work is scoped.

---

## 9. Explicit Non-Goals

- No autonomous execution outside clmm-v2. The intelligence repo and regime-engine never hold wallet keys, sign transactions, or submit on-chain operations.
- No LLM-generated numerical metrics. All deterministic metrics are code-computed. LLMs summarize evidence; they do not fabricate numbers.
- No microservice split. Each repo remains a modular monolith. No repo is broken into sub-services.
- No vanity-metric UI dump. The clmm-v2 UI shows decision-relevant context only — not every computed feature.
- No duplicated live LP truth outside clmm-v2. The intelligence repo stores historical copies for analysis but is not the operational authority.
- No new repository. All work is refactoring in place across the three existing repos.

---

## 10. Database Infrastructure

All three repos share a single Railway Postgres instance with schema-scoped isolation. Each repo has its own schema and a DB role restricted to that schema. No cross-schema foreign keys — repos communicate via HTTP, not shared queries.

| Repo                       | Schema                     | Migration Tool | Access             |
| -------------------------- | -------------------------- | -------------- | ------------------ |
| regime-engine              | `regime_engine` (existing) | Drizzle        | Schema-scoped role |
| clmm-v2                    | `clmm_v2` (existing)       | Drizzle        | Schema-scoped role |
| sol-usdc-clmm-intelligence | `intelligence` (new)       | Drizzle        | Schema-scoped role |

The intelligence repo connects to the existing shared cluster via a `DATABASE_URL` with `?schema=intelligence` query parameter. Drizzle migrations are versioned in the intelligence repo and applied against the `intelligence` schema only. No other repo's schema or data is accessed by the intelligence engine.

The schema-scoped Postgres role must be provisioned alongside the `intelligence` schema before INT-PERSIST (#5) migration work begins.

---

## 11. Glossary

| Term                  | Definition                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Evidence bundle       | Structured payload of deterministic features + contextual evidence + LLM research brief, published to Regime Engine |
| Research brief        | Schema-constrained LLM summary over bounded evidence                                                                |
| PolicyInsight         | Canonical final output: regime + action + risk + policy + reasoning                                                 |
| Deterministic feature | Code-computed numerical metric over normalized observations                                                         |
| Signal class          | Classification of evidence as deterministic, probabilistic, or contextual                                           |
| Evidence family       | Domain grouping: clmm_state, price_quality, clmm_economics, etc.                                                    |
| Hard guard            | Deterministic safety rule that cannot be overridden by evidence                                                     |
