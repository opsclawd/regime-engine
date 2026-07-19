# Evidence Selection and Scoring for Policy Synthesis

**Issue:** #60

**Status:** Proposed design

**Date:** 2026-07-18

## Problem and motivation

Regime Engine now accepts and stores strict `EvidenceBundle v1` records and can
read the latest bundle for each source within an exact scope. That query surface
is intentionally observational: it returns fresh, stale, and expired records in
repository order and does not decide whether any record should influence policy.
Passing those records directly to future PolicyInsight synthesis would make the
newest publisher output an implicit policy input regardless of its age,
confidence, provenance, coverage, or internal consistency.

The missing layer is a deterministic selector that converts current bundle
records into a bounded, synthesis-ready summary. It must explain every inclusion
and exclusion, retain source lineage, expose missing and conflicting evidence,
and explicitly degrade when research is absent. It must remain advisory: the
selector neither reads nor changes deterministic market state and cannot emit an
action, allocation, CLMM permission, or hard-guard override.

This matters because evidence includes contextual claims and an optional LLM
brief. Those inputs can inform later synthesis, but they are less authoritative
than candle-derived freshness and safety rules. An auditable selection boundary
prevents low-quality or expired research from quietly becoming policy and gives
the later synthesis issue a stable, testable input contract.

## Existing architecture and constraints

The design follows these repository facts:

- `EvidenceBundle v1` structurally separates deterministic features, five
  contextual families, an optional research brief, source references, bundle
  assessment, and provenance. The accepted bundle is immutable and already
  semantically validated.
- `EvidenceBundleRepositoryPort.getLatest` returns the latest record per
  `(source.publisher, source.sourceId)` for one exact pair/scope. It derives
  `FRESH`, `STALE`, or `EXPIRED` at a caller-supplied instant and orders records
  by source identity. It deliberately includes stale and expired records.
- `GetCurrentEvidenceUseCase` captures the clock once and delegates to the
  repository without filtering. The HTTP current-evidence route is an
  observability surface and must retain those semantics.
- Only `sol-usdc-clmm-intelligence` can publish v1 bundles, but `sourceId` is an
  opaque pipeline identity. Publisher-owned `overallConfidenceBps` is not an
  authoritative source-quality rating.
- Individual deterministic features have status, confidence, and
  `freshUntil`; contextual claims have confidence and an optional `expiresAt`;
  research briefs have lineage but no independent confidence field.
- Existing market-regime code independently computes candle freshness and
  hard guards. `GeneratePlanUseCase` refuses hard-stale market data, while
  `evaluateMarketClmmSuitability` owns deterministic `UNKNOWN`/`BLOCKED`
  decisions. Evidence selection must not couple to or weaken that path.
- The inner layers are environment-free and deterministic. Time arrives through
  `ClockPort`, policy values are explicit versioned configuration, and tests are
  co-located in `__tests__` directories.
- There is no requirement to persist a selection result yet. The evidence table
  has future-facing lineage metadata, but accepted evidence rows are append-only
  and should not be mutated with clock-dependent selection state.

## Goals

- Select usable evidence from the latest exact-scope bundle for every source.
- Apply deterministic bundle, item, confidence, and source-quality rules.
- Exclude expired, invalid, unavailable, unsupported, and under-threshold items
  with stable reason codes.
- Downweight stale-but-not-expired evidence rather than treating it as fresh.
- Bound and deterministically order the material passed to synthesis.
- Detect directional conflict without deleting either side of the conflict.
- Derive coverage from what survived selection, not merely from the publisher's
  claimed bundle coverage.
- Preserve bundle identity, item identity, evidence hashes, source-reference
  lineage, scores, and inclusion/exclusion reasons.
- Return an explicit degraded result when no contextual research or brief is
  selectable, including when no bundles exist.
- Make the output advisory-only so future synthesis must combine it with a
  separately supplied deterministic market state whose hard guards retain
  precedence.
- Produce byte-stable logical output for the same records, selection instant,
  and policy version regardless of input ordering.

## Non-goals

- Adding or changing evidence ingest/current/history HTTP routes or OpenAPI.
- Changing `EvidenceBundle v1`, generated contract types, canonical bundle
  hashing, persistence schema, migrations, or append/replay semantics.
- Persisting selection results or mutating `selectionLineage` on evidence rows.
- Producing a final `PolicyInsight`, recommendation, risk decision, allocation,
  CLMM posture, plan action, or execution request.
- Changing market-regime classification, candle freshness, plan generation, or
  any deterministic hard guard.
- Fetching evidence from external services or looking behind source references.
- Learning source quality from outcomes. The first version uses reviewed static
  policy; feedback-driven calibration is separate work.
- Combining pair, Whirlpool, wallet, and position scopes. One invocation selects
  one exact scope, matching the repository boundary. Future synthesis may invoke
  the selector for more than one scope under a separately designed precedence
  rule.
- Falling back through evidence history when a source's latest bundle is
  unusable. Selection consumes the current-per-source view established by #59.
- Treating the research brief as an independent source of facts.

## Design alternatives

### 1. Filter bundles only, then pass accepted bundles through unchanged

This is the smallest change: reject expired bundles, attach one bundle-level
score, and pass all contents of the remaining bundles to synthesis. It fails to
handle an expired claim inside a fresh bundle, unavailable or invalid features,
briefs that cite excluded evidence, family-size bounds, and conflicts between
items. It also makes publisher array order materially affect future synthesis.
This approach is not recommended.

### 2. Materialize scored evidence in new relational tables

Persisting one row per selected item would make selection history and analytics
easy to query. However, selection is clock- and policy-version-dependent, so
materializing it introduces migrations, idempotency semantics, recomputation
rules, and transactions before any consumer exists. It would also blur the
append-only publisher truth record with Regime-owned derived state. This is a
reasonable later audit feature, but it is outside this issue and not recommended
for the first selector.

### 3. Pure item-level selector with a thin application use case

Add a pure selector that accepts validated `EvidenceBundleRecord` values, one
selection instant, and a versioned Regime-owned policy. A use case captures the
clock once and reads the existing exact-scope current view. The pure function
scores and orders candidates, derives coverage/conflict, and returns a bounded
advisory summary plus complete decision lineage. This preserves the current HTTP
semantics, needs no persistence change, and can be exhaustively unit tested.
This is the recommended approach.

## Proposed architecture

### Components

The implementation should add three focused units:

1. `src/engine/evidence/selectionPolicy.ts` owns the immutable policy values,
   reason/warning codes, and `EVIDENCE_SELECTION_POLICY_VERSION`. It has no
   environment access. Changes to trust weights, thresholds, family limits, or
   stale handling require a version change.
2. `src/engine/evidence/selectEvidence.ts` is the pure policy kernel. It accepts
   records, `selectedAtUnixMs`, and a policy; it does not perform I/O and does not
   import application, adapter, ledger, HTTP, or market-regime modules.
3. `src/application/use-cases/selectEvidenceForSynthesisUseCase.ts` captures
   `ClockPort.nowUnixMs()` once, calls
   `EvidenceBundleRepositoryPort.getLatest` for `SOL/USDC` and the requested
   exact scope, then passes the records and same instant to the pure selector.

`buildApplication` exposes this use case as nullable under the same Postgres
availability rule as the three current evidence use cases. No route consumes it
in this issue. A missing configured evidence repository therefore does not
affect `getCurrentRegime`, `generatePlan`, or their deterministic dependencies.

No repository-port method is added. In particular, the observational
`GetCurrentEvidenceUseCase` is not changed to return selected evidence; raw
current evidence and internal policy selection have different purposes.

### Selection input

The pure input is conceptually:

```ts
interface SelectEvidenceInput {
  records: readonly EvidenceBundleRecord[];
  selectedAtUnixMs: number;
  scope: Scope;
  policy: EvidenceSelectionPolicy;
}
```

All records are already contract-valid. The selector still treats inconsistent
record metadata defensively: the record pair/scope must equal the invocation
pair/scope and the record lifecycle must equal a lifecycle recomputed from the
bundle timestamps at `selectedAtUnixMs`. A mismatch excludes the entire bundle
with `RECORD_SCOPE_MISMATCH` or `RECORD_LIFECYCLE_MISMATCH`; it is not silently
repaired.

The application use case accepts `{ scope: Scope }` only. It intentionally does
not accept the observational source filter: synthesis should consider all
configured sources for the exact scope. Tests may call the pure selector with
arbitrary records.

### Versioned selection policy

The initial policy should use integer basis points throughout:

```ts
interface EvidenceSelectionPolicy {
  version: string;
  minimumEffectiveScoreBps: number;
  staleWeightBps: number;
  maxSelectedPerFamily: number;
  defaultSourceQualityBps: number;
  sourceQualityBps: Readonly<Record<string, number>>;
  provenanceQualityBps: Readonly<Record<ProvenanceClass, number>>;
}
```

The recommended v1 constants are:

- minimum effective score: `2_500` bps;
- stale weight: `5_000` bps;
- maximum selected items per family: `16`;
- unreviewed source default quality: `5_000` bps;
- reviewed exact-source override: `8_000` bps once its production identity is
  explicitly configured;
- deterministic calculator provenance: `10_000` bps;
- contextual `derived`: `9_000`, `collected`: `8_000`, and
  `human_authored`: `7_000` bps.

An exact `publisher + NUL + sourceId` lookup overrides the default. Using a
length-safe or delimiter-safe key avoids identity collisions. The shipped
policy must not invent a production `sourceId`; deployment configuration is
changed in code alongside the policy version when a source is reviewed. Source
quality is Regime-owned configuration; neither `assessment.quality` nor
`assessment.overallConfidenceBps` can promote a source. Unknown identities use
the conservative default rather than being silently trusted or unconditionally
discarded.

These initial values are intentionally conservative and simple. They are policy
constants, not empirically calibrated claims. Keeping them named and versioned
allows later outcome analysis to replace them without changing selection
semantics invisibly.

### Candidate identity and families

Every candidate receives a fully qualified identity:

```text
<evidenceHash>/<kind>/<local evidence ID>
```

Kinds are `deterministic_feature`, `contextual_claim`, and `research_brief`.
Contextual family is part of the decision record. IDs are unique only within a
bundle, so the selector must never deduplicate different bundles by local ID
alone.

Selection families are:

- deterministic feature families: `market_state`, `price_quality`,
  `clmm_economics`, `position_state`, `liquidity`, and `risk`;
- contextual families: `supportResistance`, `flows`, `derivatives`, `events`,
  and `newsRegulatory`;
- `researchBrief`.

The output keeps deterministic and contextual evidence structurally separate.
It must not flatten them into a single untyped list.

## Scoring and selection rules

### Bundle eligibility

For each record:

1. `EXPIRED` excludes the bundle and every contained candidate with
   `BUNDLE_EXPIRED`. Expired evidence is never downweighted into usability.
2. `FRESH` gives a bundle freshness weight of `10_000` bps.
3. `STALE` gives a bundle freshness weight of `staleWeightBps` and adds
   `STALE_EVIDENCE_DOWNWEIGHTED` to the result.
4. A source-quality value of zero excludes the bundle as
   `SOURCE_DISABLED_BY_POLICY`.
5. Bundle assessment coverage and warnings are retained as publisher metadata,
   but do not decide selected coverage. The selector recomputes coverage from
   surviving items.

Selection evaluates all supplied records after first sorting them by source
publisher, source ID, bundle `asOf`, received time, row ID, and evidence hash,
using explicit UTF-16 string comparison. It never relies on input, `Map`, or
`Set` iteration order.

### Deterministic features

- `status: unavailable` is excluded as `FEATURE_UNAVAILABLE`.
- `status: invalid` is excluded as `FEATURE_INVALID`.
- An available feature whose `freshUntil` is before the selection instant is
  stale, not expired, because the v1 feature has no item-level expiry. Its item
  freshness weight becomes `staleWeightBps` until its bundle expires.
- A fresh available feature has item freshness weight `10_000`.
- If feature lineage names another feature in the same bundle, that dependency
  must also survive selection. After preliminary score and family-limit
  decisions, a fixed-point lineage pass excludes dependants of excluded
  features as `FEATURE_DEPENDENCY_EXCLUDED` and records the dependency IDs. The
  selector does not backfill a cap slot after this safety exclusion. Lineage
  that resolves directly to a source reference remains valid.
- Feature warnings are retained in the selected item and decision lineage; they
  do not automatically exclude a contract-valid available feature.

### Contextual claims

- A non-null claim `expiresAt` strictly before the selection instant excludes
  the claim as `CLAIM_EXPIRED`. The existing inclusive contract boundary is
  preserved: `now == expiresAt` remains usable.
- A claim with `expiresAt: null` is bounded by its bundle lifecycle.
- Claims inherit the bundle freshness weight. There is no invented soft-stale
  window based on `observedAt` because v1 supplies no family-specific lifetime.
- Provenance method contributes a policy-owned quality multiplier. Source
  references and their locators do not create additional trust merely because
  they exist.
- Neutral, mixed, and unknown directions remain eligible. Direction affects
  conflict summarization, not the evidence's inclusion score.

### Effective score

For a deterministic feature or contextual claim:

```text
effectiveScoreBps = floor(
  confidenceBps
  * sourceQualityBps
  * provenanceQualityBps
  * min(bundleFreshnessBps, itemFreshnessBps)
  / 10_000^3
)
```

All factors are integers in `[0, 10_000]`; the maximum intermediate value is
`10^16`, which exceeds JavaScript's safe integer range. The implementation must
therefore use stepwise integer multiplication/division with `bigint`, or an
equivalent exact integer helper, and convert the final bounded result to number.
Floating-point rounding is not permitted.

Using `min` for bundle and item freshness avoids applying the same stale event
twice. A score below `minimumEffectiveScoreBps` is excluded as
`BELOW_MINIMUM_EFFECTIVE_SCORE`; its component factors and calculated score are
still recorded.

Publisher `overallConfidenceBps` is retained for audit but is not multiplied
into item scores. It is a publisher self-assessment and would otherwise count
confidence twice. Item `confidenceBps` is the only publisher confidence input to
item scoring.

### Research brief

A brief cannot be treated as independent evidence because it has no confidence
field and is derived from `sourceEvidenceIds`:

- `researchBrief: null` records `RESEARCH_BRIEF_UNAVAILABLE`.
- Every cited evidence ID must correspond to an item from the same bundle that
  survived final selection, including lineage and family-limit passes. If any
  citation was excluded, the brief is excluded as
  `BRIEF_REFERENCES_EXCLUDED_EVIDENCE` with the excluded IDs.
- A surviving brief's effective score is the minimum of the bundle's
  `assessment.overallConfidenceBps` and the floor of the cited selected items'
  average effective score. This prevents a summary from becoming more trusted
  than either its publisher assessment or its supporting material.
- The same minimum score threshold applies. The brief does not add new source
  references; it inherits the union from its cited selected items.

Brief evaluation occurs after all non-brief caps and exclusions so its lineage
cannot point at material omitted from the synthesis summary.

### Family bounds and deterministic tie-breaking

Eligible candidates in each non-brief family are ranked by:

1. effective score descending;
2. bundle `asOf` descending;
3. item `observedAt` descending, with null last;
4. source publisher ascending;
5. source ID ascending;
6. local evidence ID ascending;
7. evidence hash ascending.

The first `maxSelectedPerFamily` candidates receive preliminary inclusion.
Remaining eligible candidates are excluded as `FAMILY_SELECTION_LIMIT`, after
which the deterministic-feature lineage fixed point runs. This is a synthesis
input bound, not a statement that the omitted items are false. The complete
decisions array retains scores and reasons, and brief evaluation runs only after
these decisions are terminal.

An included item receives stable reason codes such as `FRESH_HIGH_ENOUGH_SCORE`
or `STALE_HIGH_ENOUGH_SCORE`; prose messages are explanatory and must not be
parsed by consumers.

## Conflict and coverage summarization

### Directional conflict

For each contextual family, sum effective scores into `bullish`, `bearish`,
`neutral`, `mixed`, and `unknown` buckets. A family is `CONFLICTED` when both
bullish and bearish buckets are non-zero. Both sides remain selected and a
`CONFLICTING_<FAMILY>_EVIDENCE` warning is emitted.

The family summary exposes all direction totals plus:

```text
directionalConsensusBps =
  bullish + bearish == 0
    ? 0
    : floor(abs(bullish - bearish) * 10_000 / (bullish + bearish))
```

This metric describes agreement, not truth. Synthesis can see conflict without
having the selector choose a narrative. Neutral, mixed, and unknown weights are
reported separately and do not inflate directional consensus.

Deterministic feature values can have different kinds and units, so this issue
does not invent generic value-conflict semantics. Multiple selected features in
the same deterministic family are preserved. Semantic reconciliation by
calculator/feature identity belongs to synthesis policy if needed.

### Derived coverage and mode

Coverage is derived only after scoring, lineage checks, and family caps:

- a family with at least one selected item is `AVAILABLE`;
- a contextual family with selected bullish and bearish evidence is
  `CONFLICTED`;
- a family with candidates but none selected is `REJECTED`;
- a family with no candidates is `MISSING`.

The synthesis mode is:

- `FULL` when all five contextual families and a research brief are available
  and none is conflicted;
- `PARTIAL` when at least one contextual claim or brief is selected but the
  `FULL` condition is not met;
- `DEGRADED_NO_RESEARCH` when no contextual claim and no brief is selected,
  including zero records and deterministic-only bundles.

External deterministic features do not change `DEGRADED_NO_RESEARCH` to
`PARTIAL`; the mode specifically describes research enrichment. A separate
`deterministicEvidenceCoverage` summary reports selected external deterministic
families. It must not be confused with Regime Engine's independently computed
market state.

Stable `MISSING_<FAMILY>`, `REJECTED_<FAMILY>`, conflict, stale, and
`NO_RESEARCH_EVIDENCE_SELECTED` warnings are emitted in canonical family/code
order. The selector trusts neither `assessment.coverage` nor
`assessment.quality` as the selected result, though it retains both so a later
audit can compare publisher claims with actual selection.

## Selection result

The output is conceptually:

```ts
interface SelectedEvidenceSummary {
  selectionPolicyVersion: string;
  selectedAtUnixMs: number;
  pair: "SOL/USDC";
  scope: Scope;
  authority: "ADVISORY_ONLY";
  mode: "FULL" | "PARTIAL" | "DEGRADED_NO_RESEARCH";
  selected: {
    deterministicFeatures: SelectedDeterministicFeature[];
    contextualEvidence: SelectedContextualFamilies;
    researchBrief: SelectedResearchBrief | null;
  };
  familyCoverage: FamilyCoverageSummary;
  conflicts: ConflictSummary[];
  warnings: SelectionWarning[];
  sourceReferences: SelectedSourceReference[];
  bundles: BundleSelectionLineage[];
  decisions: EvidenceSelectionDecision[];
}
```

Each selected item contains the original contract item plus its qualified ID,
bundle hash/run/source identity, raw confidence, component weights, effective
score, and inclusion reason codes. `decisions` contains one entry for every
bundle and candidate considered, including expired bundle contents, with
`INCLUDED` or `EXCLUDED`, stable reason codes, relevant timestamps, scores when
calculable, and source-reference IDs.

`sourceReferences` is the deterministic union of references reachable from
selected items and from excluded-item decisions. Each entry says whether it is
`SELECTED_LINEAGE`, `AUDIT_ONLY`, or both and retains the originating bundle
identity. References with the same local `referenceId` in different bundles
remain distinct. This satisfies auditability without implying that an excluded
reference influenced synthesis.

`bundles` records row ID, hash, run/correlation/source identity, publisher
assessment, lifecycle, source-quality lookup result, and bundle decision. Raw
bundle payloads are not duplicated in the result because they remain available
from immutable storage.

All result arrays have explicit comparators and are emitted in documented
canonical order. The result does not need a public schema or persisted hash in
this issue, but the same inputs, selection instant, and policy must produce
deep-equal output and byte-identical canonical JSON.

## Hard-guard isolation

The selector enforces the authority boundary structurally:

- it does not accept `RegimeCurrentResponse`, plan state, or guard state;
- it does not return recommendation, action, allocation, `allowClmm`, or guard
  override fields;
- every result has the literal `authority: "ADVISORY_ONLY"`;
- it is wired beside, not inside, `getCurrentRegime` and `generatePlan`;
- an empty evidence read returns `DEGRADED_NO_RESEARCH` rather than modifying or
  suppressing deterministic market state;
- evidence-store unavailability remains an evidence error and cannot make the
  deterministic market endpoints unavailable, because those use cases have no
  evidence dependency.

Issue #61 must accept deterministic market state and selected evidence as
separate inputs and apply the established precedence:

```text
deterministic hard guards
  > deterministic market/evidence posture
    > contextual and LLM evidence
```

That future synthesis boundary must test that `BLOCKED`, `UNKNOWN`, and
hard-stale decisions cannot be promoted by even maximum-score research. This
issue prepares that guarantee by ensuring selected evidence carries no policy
authority. It does not duplicate final synthesis rules prematurely.

## Error and degraded behavior

- No records is a successful selection with `DEGRADED_NO_RESEARCH`, empty
  selected arrays, missing-family warnings, and no decisions. It is not 404.
- Records containing only expired or rejected evidence also return a successful
  degraded result with complete exclusion lineage.
- A transient repository failure remains `EvidenceStoreUnavailableError` and is
  not converted to an empty result; absence and infrastructure failure must be
  distinguishable.
- An invalid selection policy, non-finite selection instant, or impossible
  internal score is a programmer/configuration error and fails fast before
  partial output.
- A record metadata mismatch is isolated as a bundle exclusion when the rest of
  the records remain evaluable.
- The use case calls the clock and repository once. It never retries or reads
  history; adapter retry policy is outside the pure selector.

## Testing strategy

### Pure selector unit tests

Co-locate tests under `src/engine/evidence/__tests__/`. Fixtures should use
small contract-valid builders and a fixed instant. Required cases include:

- fresh high-confidence deterministic and contextual items are selected with
  exact component and effective scores;
- a stale bundle remains eligible, receives the exact stale multiplier, and
  emits a warning;
- an expired bundle and individually expired contextual claim are excluded at
  the inclusive timestamp boundaries;
- stale deterministic feature freshness uses the minimum freshness factor and
  is not double-penalized with a stale bundle;
- unavailable and invalid deterministic features are excluded with distinct
  reasons;
- low-confidence, unknown-source, and explicitly disabled-source cases;
- exact source override wins over publisher/default quality;
- derived, collected, and human-authored provenance produce the configured
  score differences;
- selected feature lineage closure and dependant exclusion;
- null brief, valid brief, under-threshold brief, and brief referencing an
  excluded/capped item;
- partial family coverage is recomputed from selected items despite optimistic
  publisher assessment;
- deterministic-only and completely empty inputs return explicit
  `DEGRADED_NO_RESEARCH` results;
- bullish/bearish conflicts preserve both claims, emit the warning, and compute
  exact directional totals and consensus;
- neutral/mixed/unknown claims do not create false directional conflict;
- family limit ranking and every tie-break level are deterministic;
- duplicate local evidence/reference IDs across different bundles remain
  qualified and distinct;
- permutation tests show record order does not affect deep equality or
  canonical JSON;
- every candidate receives exactly one terminal decision and every selected
  item has a matching `INCLUDED` decision;
- selected and audit-only source-reference unions are complete and ordered;
- mismatched scope/lifecycle records are excluded without corrupting valid
  peers;
- policy validation rejects out-of-range weights and limits.

The conflict fixture should include fresh, stale, and differently sourced claims
so the test proves conflict uses effective scores rather than raw claim counts.

### Application use-case tests

Co-locate tests with existing application use-case tests. Verify that the use
case:

- captures the clock once;
- calls `getLatest` once with `pair: "SOL/USDC"`, the exact scope, no source
  filter, and the captured instant;
- passes the same instant and configured policy to the selector;
- returns degraded success for an empty repository result;
- propagates `EvidenceStoreUnavailableError` unchanged;
- does not invoke any candle, regime, plan, ledger-write, HTTP, or history path.

### Composition and regression tests

Add a small composition test showing that the selector use case is present when
Postgres evidence storage is configured and null otherwise, matching existing
evidence wiring. Existing regime and plan tests remain unchanged; they are
regression evidence that selection is not inserted into deterministic paths.
No HTTP end-to-end test is required because no route changes.

## Assumptions

- Issue #59's merged `getLatest` behavior is the intended candidate read model:
  one latest bundle per source and exact scope, including its derived lifecycle.
- Policy synthesis will initially request pair-scoped evidence. The selector is
  exact-scope generic so position-scoped use can be added without changing its
  internal rules.
- The current v1 publisher may use multiple stable `sourceId` values. Source
  quality therefore needs a conservative global default plus optional
  exact-identity overrides qualified by publisher and source ID.
- Regime Engine owns source-quality policy. Publisher assessment and provenance
  are inputs/audit metadata, not permission to set trust.
- Stale evidence is useful at half weight until hard expiry. This is a
  conservative initial policy choice, not a learned optimum.
- The minimum score and family cap proposed above are acceptable initial safety
  bounds and will be versioned when calibrated.
- A context claim with `expiresAt: null` intentionally inherits the bundle's
  hard expiry; no undocumented family TTL is inferred.
- An available deterministic feature past its own `freshUntil` can be
  downweighted until bundle expiry because v1 provides no feature-level hard
  expiry.
- A research brief is usable only when all cited evidence survives selection;
  partial citation support is too ambiguous for the first version.
- The selection result is ephemeral in this issue. Final synthesized insight
  persistence will own any durable selection snapshot/lineage required for
  replay.
- Empty evidence is normal degraded operation; evidence-store failure is not
  equivalent to empty evidence.
- No questions are required to resolve these choices; any later policy change
  should update the version and its tests rather than silently changing values.

## Risks and concerns

### Source quality is not represented in EvidenceBundle v1

The selector needs a Regime-owned lookup table because the contract does not
carry an authoritative trust score. New `sourceId` values will receive the
conservative default until reviewed. Operational rollout must therefore include
a visible inventory of production source identities; otherwise good evidence
may be unexpectedly downweighted. This is preferable to automatically trusting
an opaque new source.

### Static weights are policy, not measured truth

The proposed weights and threshold are explainable but uncalibrated. They could
exclude useful low-confidence evidence or retain noisy evidence. Versioning,
component-score lineage, and later outcome analysis are necessary before tuning.

### Latest-per-source can hide an older still-usable bundle

The repository selects latest by `asOf`, receipt time, and ID. A malformed
publisher lifecycle could theoretically make a newer bundle expire before an
older bundle. The contract allows differing expiry windows, and this design does
not search history for fallback. Adding fallback would require a bounded
candidate query and explicit anti-replay semantics; it should not be hidden in
this issue.

### Candidate volume is bounded only after the database read

Each bundle is schema-bounded, and output is family-capped, but the number of
distinct source IDs returned by `getLatest` is not currently capped. A publisher
creating unbounded source IDs could increase query and selection cost. The v1
publisher identity restriction reduces but does not remove this risk. If source
cardinality grows, the repository should gain a bounded configured-source read
rather than truncating nondeterministically in the selector.

### Contract lineage is local to a bundle

Local evidence and reference IDs can repeat across bundles. All output identity,
deduplication, and reference resolution must stay qualified by bundle hash.
Using raw IDs as global `Map` keys would silently cross-wire lineage.

### Brief confidence is derived indirectly

The brief lacks its own confidence field. Deriving its score from cited evidence
and publisher assessment is conservative but may reject useful summaries. It is
safer than inventing a fixed LLM confidence or allowing the brief to outrank its
supporting evidence.

### Conflict is directional, not semantic

The generic conflict calculation catches bullish-versus-bearish disagreement
but cannot determine that two numerical support zones or two category features
are logically incompatible. Adding semantic conflict rules requires
feature/kind-specific policy and should happen only when synthesis needs it.

### Clock-dependent output is not persisted

Re-running selection later can yield a different result as evidence crosses
freshness and expiry boundaries. Future synthesis persistence must store either
the full selected summary or enough inputs—selection instant, policy version,
bundle hashes, and deterministic algorithm version—to reproduce it.

### The hard-guard guarantee completes in #61

This selector prevents evidence from carrying authority and leaves current
deterministic use cases untouched. The final proof that research cannot promote
a hard-blocked state must live where market state and evidence are actually
combined. Implementers must not interpret an `ADVISORY_ONLY` summary as
sufficient authorization in the synthesis issue.

## Scope summary

In scope is a pure deterministic evidence selector, its versioned policy, a
repository-backed internal application use case, composition wiring, and tests
covering fresh, stale, expired, partial, conflicting, missing, and lineage-heavy
cases. Explicitly out of scope are external APIs, contract/persistence changes,
selection persistence, final policy synthesis, UI, and all modifications to
deterministic market guards or execution behavior.
