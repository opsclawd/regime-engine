# feat: define EvidenceBundle v1 contract and persistence model

## Summary

Define the strict, versioned external `EvidenceBundle v1` contract that the intelligence engine publishes and Regime Engine owns durably.

The contract must support the initial deterministic vertical slice without requiring contextual collector packs or an LLM research brief.

## Correct boundary

```text
intelligence engine -> authors structured evidence bundles
Regime Engine       -> validates, stores, selects, and synthesizes policy
clmm-v2             -> consumes final PolicyInsight and retains execution authority
```

Evidence is not final policy. The ingest contract must keep deterministic features, contextual evidence, and optional LLM summaries visibly distinct.

## Required contract identity

The contract must define at least:

- `schemaVersion` with exact value `evidence-bundle.v1` or the repository's equivalent canonical version identifier;
- pair identity;
- source identity;
- run/correlation identity and idempotency key semantics;
- creation, `asOf`, and expiry timestamps;
- optional position context sufficient to distinguish pair-level from wallet/position/Whirlpool-scoped evidence;
- deterministic feature summaries;
- contextual evidence sections;
- optional research brief;
- source references;
- freshness, confidence, coverage, quality, warnings, and provenance metadata;
- canonical payload hash semantics.

All numeric units, timestamp formats, enum values, nullability, and array semantics must be explicit.

## Deterministic-only MVP semantics — hard requirement

A valid `EvidenceBundle v1` must be able to contain:

- deterministic feature summaries;
- empty contextual evidence collections or the canonical explicit unavailable representation;
- `researchBrief: null` or the canonical explicit unavailable representation;
- quality/coverage warnings that clearly state contextual and LLM evidence are absent.

The following must **not** be required for a bundle to validate, persist, or later publish:

- support/resistance evidence;
- flow evidence;
- perp/funding/liquidation evidence;
- macro/protocol/event-risk evidence;
- ecosystem news/regulatory evidence;
- an LLM research brief.

Absence is not fabrication: missing families must remain explicit in coverage/quality metadata.

## Evidence-family separation

The schema must distinguish:

### Deterministic features

Code-derived numerical or categorical evidence with explicit feature kind, status, value/unit, freshness, confidence, calculator version, and input lineage.

### Contextual evidence

Source-linked, lower-confidence research claims such as support/resistance, scheduled events, incidents, flows, perps, or news. These collections may be empty.

### Research brief

An optional schema-constrained summary over bounded evidence. It may be `null` and can never define deterministic metrics or author the final policy decision.

## Required persistence concepts

- append-only evidence records separated from final `PolicyInsight` records;
- complete accepted canonical payload retention;
- canonical serialization and hashing;
- idempotent replay for same source/run identity and identical payload;
- deterministic conflict for same source/run identity and different payload;
- current-evidence query semantics;
- bounded history query semantics;
- expiry/stale state;
- pair-level and position-scoped query support where applicable;
- lineage that remains distinct from synthesized final insight lineage.

Do not mutate an accepted historical bundle into a newer schema or content version.

## Machine-readable artifacts

This issue must publish all artifacts required for independent downstream development:

- canonical strict JSON Schema;
- generated or hand-maintained TypeScript types tied to that schema;
- one valid deterministic-only fixture with empty contextual evidence and a null brief;
- one valid fuller contextual fixture if useful;
- invalid fixtures covering schema version, units, timestamps, hashes, impossible status/value combinations, and malformed evidence families;
- canonical serialization/hash test vectors;
- documented artifact paths and schema SHA-256.

These artifacts are consumed by:

- `opsclawd/sol-usdc-clmm-intelligence#26`;
- `opsclawd/sol-usdc-clmm-intelligence#13`;
- Regime Engine #59.

## Scope

In scope:

- contract types and validation;
- EvidenceBundle persistence schema/migrations and repository boundaries;
- canonical JSON serialization/hash/idempotency semantics;
- current/history persistence query semantics;
- machine-readable schemas, fixtures, hash vectors, docs, and tests.

Out of scope:

- HTTP ingest handlers (#59);
- evidence selection/scoring (#60);
- final PolicyInsight synthesis (#61);
- intelligence publisher implementation;
- clmm-v2 changes.

## Guardrails

- Do not make contextual evidence or an LLM brief mandatory.
- Do not collapse deterministic and contextual evidence into one untyped list.
- Do not accept unknown fields silently unless the versioning policy explicitly permits them.
- Do not author final recommendation fields in the evidence contract.
- Missing evidence families must lower/qualify coverage explicitly rather than appearing as successful zero values.

## Acceptance criteria

- [ ] `EvidenceBundle v1` is strict, versioned, and machine-readable.
- [ ] A deterministic-only bundle with empty contextual evidence and `researchBrief: null` validates successfully.
- [ ] Deterministic, contextual, and LLM evidence are structurally distinct.
- [ ] Pair-level and position-scoped evidence identity is unambiguous.
- [ ] Every unit, timestamp, nullability rule, enum, and status/value relationship is documented and tested.
- [ ] Evidence records persist separately from final PolicyInsights.
- [ ] Identical source/run replays are idempotent and conflicting replays fail deterministically.
- [ ] Canonical hash test vectors can be reproduced by the intelligence repository.
- [ ] JSON Schema, valid deterministic-only fixture, fuller fixture if used, invalid fixtures, generated types, artifact paths, and schema hash are published.
- [ ] Docs state exactly which fields are supplied by intelligence and which metadata is owned/calculated by Regime Engine.

## Parent

Part of #57.

## Blocks

- #59
- `opsclawd/sol-usdc-clmm-intelligence#26`
- `opsclawd/sol-usdc-clmm-intelligence#13`
