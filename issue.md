# fix: define the canonical PolicyInsight v1 wire contract for clmm-v2

## Summary

Define, publish, and apply one strict canonical `PolicyInsight v1` read contract for clmm-v2 and other consumers.

This contract must be decided **before** policy synthesis in #61 so synthesis implements a stable output rather than inventing the public wire shape during implementation.

## Current drift to eliminate

Current code and consumers disagree on:

- `maxCapitalDeploymentPercent` vs `maxCapitalDeploymentPct`;
- `levels.support/resistance` vs `levels.supports/resistances`;
- percentage units expressed as `0..100` vs `0..1`;
- duplicated handwritten validation in downstream consumers;
- incomplete machine-readable fixtures for exact contract testing.

No adapter-side guessing or silent unit conversion may remain.

## Canonical contract decisions

### Version

Use an explicit schema/version identifier:

```text
policy-insight.v1
```

The exact property name and serialization must be fixed in the JSON Schema and examples.

### Percentages and ratios

Use explicit basis-point fields for bounded percentage-like public values.

```text
maxCapitalDeploymentBps: integer 0..10_000
confidenceBps: integer 0..10_000
```

Do not expose ambiguous `Pct` or `Percent` fields in the v1 wire contract.

### Price levels

Expose zero-or-more levels as arrays with explicit units:

```text
levels.supportsUsdcPerSol: decimal-string[]
levels.resistancesUsdcPerSol: decimal-string[]
```

Use decimal strings rather than binary floating-point JSON numbers for externally serialized price levels. Arrays may be empty; absence of evidence must not be represented as a fake zero level.

### Recommended action

Define one closed advisory enum, distinct from the Regime plan-action contract:

```text
HOLD
MONITOR_LOWER_BOUND
MONITOR_UPPER_BOUND
EXIT_TO_USDC
EXIT_TO_SOL
STAND_DOWN
```

These values communicate advisory posture. They do not authorize or submit execution; clmm-v2 remains responsible for deterministic trigger qualification, safety checks, user approval, signing, and transaction submission.

### Required decision context

The v1 contract must define exact names, enums, units, and nullability for at least:

- schema version;
- insight ID and ruleset version;
- pair and optional position identity;
- generated/as-of/expiry timestamps;
- market regime;
- fundamental regime;
- posture;
- recommended action;
- risk level;
- CLMM policy block including range bias, rebalance sensitivity, and `maxCapitalDeploymentBps`;
- support/resistance arrays with explicit units;
- evidence selection status and selected bundle/source references;
- `confidenceBps`;
- data-quality state;
- machine-readable reason codes;
- concise human-readable reasoning;
- warnings and freshness/stale status.

Unknown enum values and unknown fields must fail closed unless the documented versioning strategy explicitly permits forward-compatible extensions.

## Machine-readable artifacts

Publish:

- canonical strict JSON Schema, preferably at a stable repository path such as `contracts/policy-insight.v1.schema.json`;
- generated or schema-tied TypeScript types;
- valid fixture(s);
- invalid fixtures for old field names, wrong units, out-of-range basis points, malformed price strings, invalid enums, impossible freshness/timestamp relationships, and unknown fields;
- OpenAPI read-response examples;
- documented schema path, commit SHA, version, and SHA-256 for downstream pinning.

clmm-v2 #92 must consume these artifacts instead of maintaining an independent handwritten contract.

## Required Regime Engine changes

- update the domain/output mapping needed to emit the canonical shape;
- update current/history read handlers and serializers;
- update persistence mapping where the public shape requires it, without rewriting historical rows silently;
- update OpenAPI, docs, fixtures, and contract tests;
- remove old ambiguous public names from the v1 response;
- add compatibility behavior only when explicitly justified and documented as a temporary boundary adapter.

## Scope

In scope:

- canonical public wire-contract decision;
- JSON Schema and generated/schema-tied types;
- read serializers/handlers;
- fixtures, OpenAPI, tests, and migration/compatibility documentation;
- exact artifact handoff to clmm-v2.

Out of scope:

- evidence ingest (#59);
- evidence selection (#60);
- synthesis rules (#61), except any minimal mapping needed to preserve existing read behavior;
- clmm-v2 implementation (#92);
- execution-plan action contracts.

## Guardrails

- `PolicyInsight` is advisory and must not be confused with a signed execution request.
- No ambiguous percentage fields.
- No singular-vs-array level drift.
- No fake zero levels or silent numeric coercion.
- Do not maintain two undocumented public shapes.

## Acceptance criteria

- [ ] `PolicyInsight v1` has one strict canonical JSON Schema and exact schema version.
- [ ] `maxCapitalDeploymentBps` and `confidenceBps` use integer basis points in `0..10_000`.
- [ ] Support and resistance use `supportsUsdcPerSol` and `resistancesUsdcPerSol` decimal-string arrays.
- [ ] Recommended action uses the documented closed advisory enum.
- [ ] Every field name, enum, unit, nullability rule, timestamp relationship, and freshness state is documented.
- [ ] Current/history endpoints emit the canonical shape without adapter-side guessing.
- [ ] Old mismatched field names and unit conventions are rejected by negative fixtures or isolated behind an explicitly documented temporary compatibility mapper.
- [ ] Contract tests cover the exact public payload.
- [ ] JSON Schema, types, valid/invalid fixtures, OpenAPI examples, schema path, version, and schema hash are published for clmm-v2.
- [ ] Existing freshness/stale behavior remains explicit and tested.

## Parent

Part of #57.

## Blocks

- #61
- `opsclawd/clmm-v2#92`

## Dependency correction

This issue is **not blocked by #61**. #61 must synthesize output conforming to the contract defined here.
