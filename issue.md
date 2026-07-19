# feat: synthesize PolicyInsights from market regime plus research evidence

## Summary

Implement the canonical policy-synthesis use case that combines:

- deterministic market/regime state already owned by Regime Engine;
- current position/plan hard-guard context when available;
- selected evidence produced by #60;
- an explicit, versioned policy rule matrix.

The output must conform exactly to the canonical `PolicyInsight v1` contract defined by #63.

## Correct boundary

Regime Engine owns advisory policy synthesis. It does not sign or submit transactions.

clmm-v2 remains responsible for:

- live wallet/position/execution truth;
- deterministic breach qualification and debounce behavior;
- balance, route, slippage, fee-buffer, retry, and transaction-safety checks;
- user approval and signing;
- reporting what actually happened.

A synthesized recommendation can explain or reinforce an action, but it cannot bypass those execution controls.

## Required precedence matrix

Implement and document an explicit deterministic precedence order:

```text
1. Deterministic execution-safety and hard stale-data guards
2. Qualified clmm-v2 breach/position hard-guard state, when supplied
3. Position-plan constraints and explicit stand-down/cooldown state
4. Deterministic market regime
5. Selected deterministic evidence features
6. Selected contextual evidence
7. Optional research brief
```

Lower-precedence evidence may refine confidence, risk, posture, reasoning, or monitoring emphasis. It may not silently reverse a higher-precedence hard guard.

### Non-negotiable directional behavior

When a qualified breach is present in the deterministic position state:

- lower-bound breach context cannot be reversed by bullish research evidence;
- upper-bound breach context cannot be reversed by bearish research evidence;
- contextual evidence may explain uncertainty or risk but cannot convert the breach into a contradictory hold recommendation;
- the final insight remains advisory and does not itself authorize execution.

When no qualified breach is present, market regime and selected evidence may produce monitor, hold, defensive, or stand-down guidance according to the versioned rule matrix.

## Versioned ruleset

Define a stable ruleset identifier, for example:

```text
sol-usdc-policy.v1
```

Persist it with every synthesized insight. A ruleset change must produce a new auditable version rather than altering the historical interpretation silently.

The rule matrix must be code/configuration that can be tested deterministically. Do not delegate the final action choice to an unconstrained LLM prompt.

## Required input handling

Synthesis must consume:

- canonical current market regime/state;
- current position/plan context where available and fresh;
- the deterministic selection result from #60, including selected and rejected evidence and reasons;
- explicit freshness, expiry, confidence, coverage, source quality, and warning metadata;
- optional research brief only as bounded explanatory evidence.

Never read raw external evidence directly around the selector or use “latest payload wins.”

## Degraded operation

Synthesis must still produce an explicit result when external evidence is absent or degraded:

- no evidence -> use deterministic Regime Engine state and mark evidence selection `NONE`/degraded;
- partial evidence -> use eligible evidence only and expose missing-family warnings;
- stale/expired evidence -> exclude or downweight according to #60 and explain the exclusion;
- persistence unavailable -> fail explicitly rather than fabricating a current insight;
- optional brief unavailable -> continue without it.

Missing evidence must never become successful zero-valued evidence.

## Required output

Produce and persist exactly one canonical `PolicyInsight v1` as defined by #63, including at least:

- schema and ruleset versions;
- insight identity;
- pair and optional position identity;
- generated/as-of/expiry timestamps;
- market and fundamental regimes;
- posture and recommended advisory action;
- confidence, risk, and data-quality state;
- CLMM policy block;
- support/resistance arrays when selected evidence supports them;
- evidence-selection status and selected bundle/source references;
- machine-readable reason codes;
- concise reasoning and warnings;
- complete lineage to deterministic state, selection result, and evidence inputs.

Do not invent a second output shape inside this issue.

## Persistence and audit

Persist enough synthesis input/output material to reconstruct why an insight was emitted:

- ruleset version;
- deterministic market/position state references or snapshot hash;
- evidence-selection result identity;
- selected and excluded bundle/evidence references with reasons;
- canonical output payload/hash;
- timestamps and freshness state.

Identical re-execution over the same ruleset and canonical input set must be idempotent or deterministically deduplicated. Changed inputs or ruleset versions remain historically distinct.

## Scope

In scope:

- policy-synthesis application/domain use case;
- versioned deterministic rule matrix;
- precedence and degraded-mode handling;
- mapping to canonical `PolicyInsight v1`;
- final insight persistence and audit lineage;
- current/history integration as needed;
- fixtures, tests, and documentation.

Out of scope:

- evidence ingestion (#59);
- evidence selection/scoring (#60);
- defining a different wire contract (#63 owns it);
- clmm-v2 UI or execution flows;
- autonomous transaction submission.

## Guardrails

- Deterministic hard guards remain authoritative.
- Research evidence cannot silently reverse a qualified breach.
- An LLM cannot select the final action or invent numerical metrics.
- Synthesis remains usable in explicit degraded mode without research evidence.
- Final insight lineage must be auditable.

## Acceptance criteria

- [ ] Synthesis consumes only the selection result from #60, not arbitrary latest evidence.
- [ ] Output validates exactly against the `PolicyInsight v1` schema from #63.
- [ ] A versioned rule matrix and precedence order are implemented and documented.
- [ ] Lower- and upper-bound qualified breach tests prove contradictory contextual evidence cannot reverse the directional posture.
- [ ] No-evidence, partial, stale, expired, conflicting, and optional-brief-unavailable cases produce explicit deterministic outcomes.
- [ ] Every recommendation includes machine-readable reason codes, concise reasoning, source/evidence references, confidence, risk, data quality, and freshness.
- [ ] Stored lineage identifies the ruleset, deterministic inputs, evidence selection, selected/rejected evidence, and canonical output hash.
- [ ] Calm, upward trend, downward trend, chop, stressed/high-volatility, sparse-evidence, and poor-price-quality scenarios are covered by tests.
- [ ] No execution authority or transaction submission is introduced.

## Parent

Part of #57.

## Blocked by

- #60
- #63
