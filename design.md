# Deterministic PolicyInsight Synthesis

**Issue:** #61

**Status:** Proposed design

**Date:** 2026-07-19

## Problem and why it matters

Regime Engine already owns two inputs needed for policy advice: deterministic market-state computation and position-scoped plan guards. Issue #60 added the third input, a deterministic selector that turns stored `EvidenceBundle v1` records into a bounded `SelectedEvidenceSummary` with scores, freshness treatment, conflicts, warnings, and complete inclusion/exclusion lineage. The service does not yet have the policy layer that combines those inputs into the one canonical `PolicyInsight v1` owned by issue #63.

Without that layer, the existing insight API remains a passive mailbox. `POST /v1/insights/sol-usdc` accepts an externally authored recommendation, `clmm_insights` stores it, and the current/history handlers replay it. That bypasses Regime Engine's candle freshness, CLMM suitability, breach qualification, cooldown, and stand-down policy. It also permits research prose to arrive as a final action without an auditable rule proving how higher-authority state constrained it.

The new synthesis path must make Regime Engine the sole policy author while preserving the authority boundary: it recommends but never signs, submits, or claims that execution occurred. This matters most during conflict and degradation. A qualified range breach must not turn into a contradictory hold because a research brief is bullish or bearish, and absent evidence must not be represented as a successful zero-valued signal.

## Repository findings that shape the design

- `src/engine/marketRegime/buildRegimeCurrent.ts` already produces the canonical regime, telemetry, CLMM suitability, market reasons, freshness, candle lineage, and engine/config versions. `GeneratePlanUseCase` additionally refuses hard-stale market data.
- `src/engine/plan/positionPlan.ts` already encodes the position precedence needed here: qualified range breach, blocked suitability for an active position, churn stand-down, unqualified breach, unknown data quality, then hold. Reimplementing that logic independently would create drift.
- `PlanRequest.position` carries `rangeState`, `breachQualified`, price bounds, observation time, and optional position telemetry. `PlanResponse` carries the advisory action, constraints, market data, reasons, and `planHash`. It does not represent live execution truth.
- `src/engine/evidence/selectEvidence.ts` returns selected and rejected items, bundle lineage, conflicts, coverage, warnings, source references, scores, and selection-policy version. It is deterministic for records, scope, selection instant, and policy. The selection result is neither persisted nor assigned an identity/hash today.
- Selection is exact-scope. Pair, Whirlpool, wallet, and position evidence are not merged by #60. The synthesis caller must therefore choose one scope explicitly rather than search around the selector.
- The evidence contract has generic feature IDs and numeric/string/boolean values. Contextual support/resistance claims contain prose and direction, not structured numeric prices. Synthesis cannot safely infer numerical levels from claim text.
- The current `src/contract/v1/insights.ts` shape and `regime_engine.clmm_insights` table represent legacy externally authored insights. They lack ruleset version, insight identity, selection identity, input snapshots/hashes, reason-code lineage, and the richer #63 fields.
- Current insight reads order by `asOf`, while history orders by receipt time. A new canonical store needs one documented ordering rule and a stable ID tie-breaker.
- Clean Architecture boundaries are enforced: `src/engine/**` cannot import application, adapters, ledger, composition, or runtime APIs; application code can depend only inward and through ports. Time and persistence must be injected.
- PostgreSQL is already mandatory for evidence and insight capabilities in production. Evidence-store absence is represented by nullable composition dependencies, while transient repository failures become explicit application errors.
- Issue #63's canonical artifacts are not present in this worktree. This issue is blocked on them and must consume them rather than extending the legacy contract or guessing a replacement.

## Goals

- Produce exactly one strict `PolicyInsight v1` for one canonical synthesis input envelope.
- Encode precedence and policy decisions in testable, versioned code/configuration.
- Reuse authoritative regime and position-plan results instead of duplicating their guard logic.
- Permit selected evidence to refine only the dimensions allowed at its precedence level.
- Continue deterministically in no-evidence, partial-evidence, stale-evidence, conflict, and missing-brief modes.
- Persist an append-only output plus enough canonical input and lineage material to reconstruct it.
- Deduplicate semantically identical synthesis attempts, including concurrent attempts.
- Preserve the current/history read resources while replacing their backing data with internally synthesized canonical insights.

## Approaches considered

### 1. Pure synthesis reducer plus application orchestration and a dedicated append-only store — recommended

A pure engine function accepts an immutable, already-resolved synthesis envelope and a versioned ruleset, then returns a #63 `PolicyInsight v1`. An application use case captures the clock once, obtains authoritative market/plan state and the #60 selection result through injected collaborators, computes stable fingerprints, checks idempotency, invokes the reducer, validates the exact #63 contract, and persists the output through a repository port.

This follows the existing pure-core/application/adapter split, makes the rule matrix easy to fixture-test, and isolates storage races and failures from policy logic. A dedicated synthesized-insight table prevents legacy external rows from being mistaken for canonical output. The trade-off is more explicit types and mapping code, plus a migration/cutover for existing current/history readers.

### 2. Extend the position plan builder to emit and persist PolicyInsights

This would reuse breach and churn precedence directly and could synthesize after every `/v1/plan` call. It was rejected because PolicyInsights are also required without a position, evidence updates need not coincide with plan requests, and plan persistence is SQLite while evidence/final insight persistence is PostgreSQL. It would turn a pure plan concern into a research and storage concern and make a plan request partially fail after its plan had already been committed.

### 3. Synthesize lazily in `GET /current`

This avoids a separate command trigger and always evaluates recent data at read time. It was rejected because GET would acquire write side effects, concurrent readers could create races, historical results would depend on observation traffic, and persistence failure would blur “no insight” with “could not create insight.” It also makes byte-stable replay harder because wall-clock freshness changes during a read.

## Proposed architecture

### Canonical synthesis envelope

The pure reducer receives a single input object with no repositories, HTTP types, environment values, or implicit clock reads:

- `synthesisAtUnixMs`, captured once by the application use case;
- `pair` and exact evidence `scope`;
- a canonical `RegimeCurrentResponse` snapshot or equivalent domain projection, including freshness, suitability, reasons, candle count, and engine/config versions;
- optional position-plan context, consisting of a validated current position snapshot and the authoritative `PlanResponse` produced from it, including `planId`, `planHash`, action, cooldown/stand-down constraints, and observation time;
- the complete `SelectedEvidenceSummary` returned by #60, not raw evidence rows and not a second selector implementation;
- stable fingerprints for the regime snapshot, optional position/plan snapshot, and selection result;
- the validated synthesis ruleset.

The application layer must ensure all time-sensitive reads use the same captured `synthesisAtUnixMs`. It must reject mismatched pair/scope, a plan whose `planHash` does not verify, a position snapshot outside the ruleset's freshness limit, or a selection whose `selectedAtUnixMs` differs from the captured instant. No “latest payload wins” fallback is allowed.

Position context is optional. If supplied and fresh, the synthesized insight is position-scoped and includes the position identity required by #63. If absent, the result is pair-scoped and the position identity is omitted. Stale supplied position context is a hard guard, not equivalent to absent context: the result is explicitly paused/stand-down with poor data quality and a stale-position warning.

### Modules and responsibilities

The intended boundaries are:

- `src/engine/policy/ruleset.ts`: immutable ruleset definition and validation. It owns `sol-usdc-policy.v1`, threshold constants, allowed state transitions, feature bindings, reason-code ordering, and expiry limits.
- `src/engine/policy/synthesizePolicyInsight.ts`: pure precedence reducer. It owns no I/O, clock, canonical hashing, or LLM calls.
- `src/engine/policy/reasoning.ts`: deterministic templates that turn reason codes and selected lineage into concise bounded reasoning/warnings. It never copies arbitrary research prose into an action rule.
- `src/application/use-cases/synthesizePolicyInsightUseCase.ts`: captures/validates the complete envelope, computes fingerprints and idempotency key, invokes the reducer, validates the #63 output, and coordinates persistence.
- `src/application/ports/policyInsightRepositoryPort.ts`: atomic insert-or-return-existing, current read, and cursor-based history read.
- `src/adapters/postgres/postgresPolicyInsightRepository.ts`: append-only persistence and race-safe deduplication.
- HTTP current/history handlers: thin adapters over application read use cases, returning only #63-defined success shapes and the existing error taxonomy.
- Composition: creates the repository and use cases only when PostgreSQL is available and exposes an explicit synthesis command to the trusted internal caller.

No new public endpoint is required by this design. The application command is the stable entry point for an internal scheduler/orchestrator or a later thin authenticated adapter. Synthesis must not be hidden inside current reads, evidence ingest, candle ingest, or plan generation. The concrete production trigger is assumed to be composition/runtime work in this issue if one already exists by implementation time; otherwise exposing the composed command for the established internal caller is sufficient and trigger scheduling is documented as follow-up integration.

### Versioned ruleset and precedence reducer

The ruleset identifier is `sol-usdc-policy.v1`. The identifier is persisted in every output and forms part of the idempotency key. Any change that can alter action, posture, confidence, risk, data quality, level extraction, expiry, reason codes, or reasoning text requires a new ruleset version.

The reducer evaluates these stages in order and locks fields as authority is established:

| Precedence | Condition                                                                                                       | Required semantic outcome                                                                                                | Fields locked against lower levels                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1          | Market hard-stale, insufficient/unknown safety data, invalid snapshot linkage, or supplied position state stale | `pause_rebalances`/stand-down semantics, paused posture, critical or elevated risk, degraded/stale data quality          | action, posture, minimum risk, maximum confidence, CLMM permission |
| 2          | Fresh qualified below-range or above-range breach                                                               | `exit_range`, defensive posture, CLMM deployment disabled; direction-specific reason code                                | action, posture, CLMM permission                                   |
| 2          | Existing authoritative plan requests exit because an active CLMM position is blocked                            | `exit_range`, defensive posture, CLMM deployment disabled                                                                | action, posture, CLMM permission                                   |
| 3          | Explicit stand-down active                                                                                      | `pause_rebalances`, paused posture, CLMM deployment disabled until the supplied boundary                                 | action, posture, CLMM permission                                   |
| 3          | Cooldown active without a higher guard                                                                          | at least `hold`/`watch`, no increased rebalance sensitivity or capital deployment                                        | minimum caution bounds                                             |
| 4          | `UP` or `DOWN`, or deterministic CLMM suitability `BLOCKED`                                                     | defensive monitoring; no evidence-created CLMM permission                                                                | posture and CLMM permission                                        |
| 4          | `CHOP` with `ALLOWED` suitability                                                                               | neutral/eligible baseline subject to lower-level risk refinement                                                         | baseline only                                                      |
| 5          | Allowlisted selected deterministic feature crosses a versioned threshold                                        | may lower capital cap, widen/passivate range, raise risk, reduce confidence, or produce stand-down if explicitly encoded | only the affected safety bound                                     |
| 6          | Selected contextual claims and conflict summary                                                                 | may move confidence downward, raise risk, or increase monitoring emphasis; may not relax a locked field                  | no reversal authority                                              |
| 7          | Selected research brief                                                                                         | contributes bounded explanation and warning context only                                                                 | no action or numerical authority                                   |

`below-range` and `above-range` breaches both remain `exit_range`; separate reason codes preserve direction. Bullish evidence cannot change a qualified lower-bound exit to hold, and bearish evidence cannot change a qualified upper-bound exit to hold. The final object always marks its authority as advisory according to #63 and contains no executable instruction, transaction data, route, slippage, or approval state.

The reducer should use monotone modifiers after the baseline decision: lower-precedence stages may make posture more defensive, risk higher, confidence lower, deployment smaller, range wider/more passive, or monitoring stronger. They cannot move those dimensions in the permissive direction once a higher-precedence stage locks them. Implementing this as ordered state plus explicit lock flags is clearer and safer than a score where positive and negative evidence can cancel a hard guard.

### Evidence interpretation

The selector's result is authoritative for evidence eligibility. Synthesis never loads bundles, follows URLs, parses raw source material, recomputes scores, or resurrects excluded candidates.

The ruleset contains an allowlist of deterministic feature bindings. Each binding identifies the expected semantic feature, family, calculator name/version, feature kind, and unit, plus bounded thresholds and the policy dimensions it may tighten. Unknown features remain in lineage but cannot affect policy. This prevents an opaque `featureId` or numerically incompatible unit from silently acquiring meaning.

Contextual directions are aggregated only from #60's selected claims and conflict totals. They influence confidence, risk, fundamental-regime classification, and reasoning through explicit thresholds. Conflicted families cannot produce a directional upgrade and add a conflict warning. Neutral/mixed/unknown claims never count as bullish or bearish votes.

The optional research brief is not interpreted to choose an action or extract metrics. If its lineage survived #60, a bounded summary may be included as explanatory text only if #63 permits; otherwise the output references its brief ID and source evidence IDs. Missing or rejected briefs add warnings but do not fail synthesis.

Support/resistance arrays are populated only from selected deterministic numeric features bound by the ruleset to support/resistance semantics with an exact expected price unit. They are deduplicated and sorted numerically, with contract limits applied deterministically. The current contextual support/resistance claim shape contains prose but no numeric level, so its text must not be parsed into a price. When no eligible structured numeric levels exist, arrays are empty if #63 permits them; if #63 requires a non-empty level block, this ruleset must omit the optional block rather than invent values.

### Confidence, risk, fundamental regime, and data quality

These outputs are categorical mappings defined in the ruleset, never free-form model judgments:

- Start confidence from deterministic market quality and sample/freshness state. Cap it for soft-stale market data, stale selected evidence, partial coverage, conflicts, or stale position context. Evidence agreement may support the existing cap but cannot raise confidence above the deterministic-state ceiling.
- Start risk from market suitability and volatility. Raise it for hard guards, selected risk/price-quality features, conflicts, missing critical evidence families, and stale inputs. Lower-precedence evidence cannot reduce risk below a higher-stage floor.
- Derive `fundamentalRegime` from deterministic allowlisted fundamentals first, then selected contextual directional consensus. Conflict or insufficient coverage maps to the #63 neutral/unknown value, not a fabricated directional label.
- Derive data quality from the worst relevant authoritative state: hard-stale/invalid, soft-stale, selection mode, stale selected inputs, missing/rejected families, and conflict. Missing research is degraded metadata, never a zero observation.

Exact enum spellings and percentage units come exclusively from #63. In particular, implementation must not carry forward the legacy ambiguity between `maxCapitalDeploymentPercent` and `maxCapitalDeploymentPct`, singular/plural level fields, or `0..1` versus `0..100` values.

### Reason codes, reasoning, and warnings

Reason codes are stable ruleset-owned constants, ordered first by precedence and then lexicographically within a stage. At minimum the first version distinguishes:

- market hard stale, soft stale, insufficient samples, and blocked suitability;
- qualified lower breach and qualified upper breach;
- blocked active position, cooldown, and stand-down;
- `UP`, `DOWN`, and `CHOP` baselines;
- deterministic feature tightening by binding ID;
- evidence mode `NONE`/degraded, partial coverage, stale selection, expired/rejected candidates, family conflict, and missing optional brief;
- no eligible structured support/resistance levels;
- advisory-only/no-execution-authority.

Reasoning strings are generated from fixed templates using validated categorical values and bounded identifiers. They are concise, stable, and ordered with their reason codes. Warnings from #60 are mapped to #63 warning codes without dropping the original selection lineage. Arbitrary claim or brief prose is not promoted into a machine reason code.

### Freshness and expiry

One application clock value is used for market reads, evidence selection, position validation, output generation, and persistence metadata. The output expiry is the earliest applicable boundary among:

- the ruleset's maximum insight lifetime;
- the market hard-stale boundary derived from the last closed candle;
- the position freshness boundary, when position context is supplied;
- selected evidence item/bundle expiry boundaries available in selected original items and bundle lineage.

If the computed expiry is not after generation time, synthesis emits an immediately degraded/stand-down result only when #63 supports a valid future expiry using a small ruleset-defined safety TTL; it must not label expired inputs fresh. If #63 disallows that representation, the use case fails with an explicit invalid-current-input error and persists nothing. This behavior is fixed when #63 lands and is covered by contract tests.

### Identity, hashing, and deterministic deduplication

The application layer computes canonical SHA-256 fingerprints with the repository's existing canonical JSON utility:

- `marketStateHash`: regime snapshot excluding presentation-only moving fields such as `ageSeconds`, while retaining source candle identity, freshness class/boundaries, telemetry, and config/engine versions;
- `positionPlanHash`: the verified `planHash` plus a canonical hash of the supplied position observation, or an explicit `NONE` marker;
- `selectionHash`: the full #60 selection result excluding only presentation-time fields, while retaining policy version, scope, mode, scores, selected/rejected decisions, bundle hashes, warnings, conflicts, and source references;
- `synthesisInputHash`: ruleset version + pair/scope + the three preceding fingerprints.

The exact exclusions are versioned with the ruleset and documented; no adapter may improvise them. A deterministic `insightId` is derived from the full input hash, using the #63 identity format. `payloadHash` is SHA-256 over canonical validated `PolicyInsight v1` output.

Before invoking the reducer, the use case checks for `synthesisInputHash`. If present, it returns the stored canonical output. If absent, it builds the output with the captured generation time and attempts an insert. A unique index on `(schema_version, ruleset_version, synthesis_input_hash)` makes concurrent identical attempts race-safe; the loser reads and returns the winner. Thus operational retries return one historical insight even though the first creation timestamp is assigned at runtime. A change to meaningful state, effective freshness class, selection decisions, scope, position snapshot, or ruleset creates a distinct row.

### Persistence and audit model

Add a dedicated append-only `regime_engine.policy_insights` table rather than extending `clmm_insights`. Required columns are:

- surrogate row ID, canonical insight ID, schema version, ruleset version, pair, scope key, optional position ID;
- generated/as-of/expiry and persisted timestamps;
- market-state, optional position-plan, selection, and full synthesis-input hashes;
- selection policy version and selected evidence bundle/source identifiers needed for indexed audit queries;
- canonical input envelope JSON and canonical output JSON;
- output payload hash;
- selected and excluded evidence decision/lineage JSON when it is not already wholly preserved in the canonical input envelope.

The canonical input envelope is the reconstruction source of truth; typed/index columns optimize lookup and enforce invariants. Database checks enforce supported schema/ruleset versions, pair, timestamp ordering, and lowercase 64-character hashes. Rows are never updated or deleted by synthesis.

Persistence occurs in one PostgreSQL transaction. There is no successful in-memory fallback. Repository unavailability maps to an explicit service-unavailable application error and no fabricated current insight is returned. The legacy `clmm_insights` table remains readable only for migration/audit purposes until #62 decides its removal; canonical current/history endpoints switch atomically to `policy_insights` and never merge legacy and canonical rows.

### Current and history reads

The existing resources remain:

- `GET /v1/insights/sol-usdc/current`
- `GET /v1/insights/sol-usdc/history`

Both become thin adapters over repository-backed application read use cases and return only #63 contract shapes. Current selects the newest persisted canonical insight for the requested/default scope by `generated_at_unix_ms DESC, id DESC`; position-specific reads require the #63-approved scope selector. It reports stored insight freshness from its timestamps without synthesizing or mutating state. No row yields the existing not-found category; no repository yields explicit service unavailable.

History uses a bounded cursor `(generatedAtUnixMs, id)` rather than an unbounded offset and orders by the same tuple as current. The history envelope, pagination fields, and current freshness wrapper must be exactly those defined by #63; this issue does not create alternate DTOs.

## Data flow

1. A trusted internal caller invokes `SynthesizePolicyInsightUseCase` with market selectors, exact evidence scope, and optional current position/plan context.
2. The use case captures the clock once and obtains or verifies the canonical Regime Engine state.
3. If position context exists, it verifies freshness and the canonical plan hash. The existing plan result is treated as the authority for breach/churn action; synthesis does not rerun a divergent position policy.
4. The use case invokes #60's `SelectEvidenceForSynthesisUseCase` for exactly the supplied scope and shared instant. Empty repository results legitimately produce its deterministic degraded summary.
5. It computes the canonical fingerprints and checks the insight repository for an existing synthesis input.
6. On a miss, the pure reducer applies `sol-usdc-policy.v1`, maps to the imported #63 type, and generates deterministic reason/warning order.
7. The application validates the produced object with #63's runtime validator, canonicalizes it, and computes the output hash.
8. The repository atomically inserts the complete audit record or returns the concurrent winner.
9. Current/history queries later return the persisted canonical payload. They never rebuild it from lossy typed columns.

## Degraded operation

- **No evidence records:** use the #60 `DEGRADED_NO_RESEARCH` result, preserve empty selection lineage, use deterministic market/position policy, and map to #63's `NONE`/degraded evidence status.
- **Partial evidence:** use only selected candidates, surface missing/rejected-family warnings, and cap confidence/data quality according to the ruleset.
- **Stale but eligible evidence:** honor #60's single downweighting, surface stale warnings, and shorten expiry as appropriate. Do not downweight a second time as though it were a score.
- **Expired evidence:** it remains excluded in #60 decisions and audit lineage and cannot contribute to any policy dimension.
- **Conflicting evidence:** preserve both sides and the computed conflict; do not average a conflict into false certainty. It may raise risk/lower confidence but not relax a guard.
- **Optional brief unavailable or rejected:** continue without it and emit the mapped warning.
- **Market or supplied position hard stale:** emit the deterministic paused/stand-down safety outcome if representable by #63, regardless of evidence direction.
- **Persistence unavailable:** fail explicitly. Do not return an unstored “current” insight.

## Testing strategy

### Pure ruleset and reducer tests

- Validate the ruleset and freeze/copy behavior; reject invalid thresholds, duplicate reason ordering, unknown enum mappings, and inconsistent feature bindings.
- Table-drive every precedence row and every allowed monotone modifier.
- Prove bullish research cannot reverse a qualified lower-bound exit and bearish research cannot reverse a qualified upper-bound exit.
- Prove contextual/brief input cannot authorize CLMM, increase capital, lower a locked risk floor, or choose an action.
- Cover calm CHOP, upward trend, downward trend, extreme/stressed volatility, sparse evidence, poor price quality, cooldown, and stand-down.
- Cover no evidence, partial selection, stale inclusion, expired exclusion, conflicts, missing families, and unavailable brief.
- Cover allowlisted feature type/unit/calculator matching and prove unknown or mismatched numeric features do not affect output.
- Cover deterministic support/resistance extraction, sorting, deduplication, bounds, and the no-structured-level case.
- Assert the same envelope/ruleset produces byte-identical canonical output when generation time is fixed.

### Application tests

- Capture the clock once and pass the same instant to every time-sensitive collaborator.
- Reject pair/scope, selection-time, plan-hash, and position-freshness mismatches.
- Assert exact replay returns the stored row without inserting a second one.
- Assert changed market, position, selection, scope, or ruleset fingerprints produce distinct history.
- Simulate concurrent insert conflict and return the winning canonical row.
- Propagate repository unavailability explicitly and never return an unpersisted result.
- Validate every result against #63 before persistence.

### Adapter, migration, and HTTP tests

- PostgreSQL migration shape, checks, unique input hash, append-only behavior, current ordering, cursor history, and canonical JSON round-trip.
- End-to-end synthesis with a real PostgreSQL test database and fake authoritative inputs.
- Current/history contract tests using #63 valid fixtures and negative shape assertions.
- Verify canonical endpoints never return a legacy externally authored row and that no external final-policy write path is introduced by this work.
- OpenAPI snapshots/contract checks where #63 exposes schemas.
- Run typecheck, unit tests, PostgreSQL tests, lint, boundary checks, format check, and production build.

## Assumptions

- Issue #63 lands before implementation and supplies the sole `PolicyInsight v1` TypeScript type, runtime validator, JSON Schema, fixtures, identity format, enum spellings, units, current envelope, and history envelope. This design does not guess or fork those artifacts.
- `sol-usdc-policy.v1` is the first synthesis ruleset and only SOL/USDC is supported.
- The trusted caller can provide an exact evidence scope and, when applicable, a canonical fresh position snapshot plus verified PlanResponse. Regime Engine does not query live wallet/position state from clmm-v2.
- Pair-scoped synthesis is valid when position context is unavailable. It must not imply a position-specific breach decision.
- The existing position plan is the authoritative reusable source for qualified-breach, blocked-active-position, cooldown, and stand-down outcomes. Synthesis maps those outcomes rather than creating a second qualification/debounce algorithm.
- #60 remains the sole selector. Its complete summary can be embedded in the audit input even though #60 does not currently persist or hash selections.
- PostgreSQL is the authoritative persistence layer for canonical insights. SQLite plan/execution ledgers remain unchanged.
- A trusted runtime trigger exists or will call the composed application command. A new public synthesis route and a scheduling policy are not necessary to define the domain use case.
- Structured numerical S/R values are usable only when an allowlisted deterministic feature supplies them with an expected unit. Contextual prose is not parsed for numbers.
- Existing legacy insight rows do not satisfy #63 and are not exposed through the canonical read path after cutover.

## Scope

### In scope

- Pure policy synthesis and deterministic reasoning templates.
- The explicit `sol-usdc-policy.v1` matrix, feature bindings, precedence, locks, confidence/risk/data-quality mapping, and degraded modes.
- Application orchestration around existing regime/plan state and #60 selection.
- Exact mapping and validation against #63's canonical output.
- Stable input/output hashing, insight identity, idempotency, and concurrent deduplication.
- New append-only PostgreSQL persistence and complete audit lineage.
- Canonical current/history repository and handler integration as required by #63.
- Fixtures, unit/integration/contract tests, OpenAPI updates where owned here, and documentation.

### Explicitly out of scope

- Evidence ingestion, selection/scoring changes, external fetches, or “latest payload wins” logic.
- Defining or modifying `PolicyInsight v1`; #63 owns the wire contract.
- Removal/migration policy for the legacy external insight POST beyond ensuring it is not used by synthesis; #62 owns final removal.
- clmm-v2 breach qualification, debounce, live balances, position truth, routing, fees, slippage, retry, approvals, signing, or transaction submission.
- LLM action selection, metric generation, numerical extraction from prose, or unconstrained reasoning generation.
- Automatic outcome learning, backtesting/calibration, multi-pair support, UI work, or cross-repository adapters.
- Combining evidence across scopes or introducing a scheduler/public synthesis command unless an existing runtime integration requires a thin adapter.

## Risks and concerns

### #63 contract dependency

The canonical contract is absent from this branch. Its exact freshness representation, optional level semantics, scope selector, and action enums may constrain the reducer. Implementation must begin by importing #63 and resolving those details; modifying the legacy `InsightIngestRequest` would violate the issue boundary.

### Missing structured S/R values

`EvidenceBundle v1` contextual support/resistance claims contain text and direction but no price. Blind number extraction would violate determinism and the no-invented-metrics guardrail. The safe first version may often emit no levels unless publishers also provide allowlisted deterministic numeric features. If #63 requires levels, the upstream evidence contract needs a separately versioned enhancement rather than a synthesis workaround.

### Plan/state duplication and freshness

Market regime and plan generation currently compute related state through separate use cases, and position truth is caller-supplied rather than stored as a canonical current projection. Accepting arbitrary pieces would risk a regime/plan mismatch. The synthesis envelope therefore needs strict fingerprint and timestamp linkage, and the implementation should extract shared pure projections only where needed to prevent drift.

### Trigger ambiguity

The issue specifies the use case and persistence but not when production invokes it. Hiding synthesis in GET, evidence ingest, candle ingest, or plan generation creates worse transactional and coupling problems. The design exposes an explicit internal command and treats runtime scheduling/adapter choice as composition integration. Deployment must verify that a trusted caller actually invokes it before switching current reads.

### Cross-store atomicity

Plan facts are in SQLite while evidence and canonical insights are in PostgreSQL. No transaction can atomically cover both. The canonical input envelope and verified hashes are therefore essential: persistence records exactly which immutable plan/evidence snapshots were used rather than claiming a distributed snapshot transaction.

### Time-dependent idempotency

Freshness changes with time even when source rows do not. Fingerprints must include effective freshness classes and expiry boundaries but exclude presentation-only ages, or retries will either create needless history or reuse an insight after a meaningful boundary changes. Boundary-equality tests are required.

### Legacy cutover

The existing current/history handlers reconstruct a legacy payload from typed columns, and the legacy table can contain externally authored records. Mixing both generations would make “current” nondeterministic and violate the exact #63 contract. Cutover must be atomic at the read adapter and covered by regression tests; legacy history can remain accessible only through an explicitly non-canonical audit path if separately required.

### Reasoning leakage and output bounds

Selected claims and briefs can contain long publisher-authored prose. Copying them wholesale risks unstable, oversized, or misleading reasoning. Fixed templates, bounded identifiers, deterministic ordering, and #63 maximum lengths must be enforced before hashing and persistence.

## Acceptance mapping

| Issue requirement                | Design mechanism                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Consume only #60 selection       | Synthesis envelope accepts `SelectedEvidenceSummary`; no evidence repository access in the reducer |
| Validate exact #63 output        | Runtime validation before canonicalization/persistence; handlers reuse #63 DTOs                    |
| Versioned rules and precedence   | `sol-usdc-policy.v1`, ordered reducer stages, monotone locks, persisted ruleset version            |
| Breach direction cannot reverse  | Position plan authority plus lower/upper fixture tests and action/posture locks                    |
| Explicit degraded modes          | Deterministic mapping for empty, partial, stale, expired, conflict, and no-brief selections        |
| Complete recommendation metadata | #63 mapping plus stable reason/warning templates and selection source references                   |
| Auditable lineage                | Canonical input envelope, component hashes, full selection decisions, output canonical JSON/hash   |
| Deterministic scenario coverage  | Table-driven reducer fixtures and snapshot/hash tests across all named market/data states          |
| No execution authority           | Advisory contract marker, no transaction fields/dependencies, boundary tests                       |
