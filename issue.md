# feat: select and score fresh research evidence for synthesis

## Summary

Add the internal selection/scoring layer that chooses which evidence Regime Engine should use during policy synthesis.

## Why

Regime Engine should not blindly accept "latest payload wins." It needs deterministic rules for freshness, confidence, source quality, expiry, and evidence family coverage before research can influence policy.

## Required behavior

- read current valid evidence;
- reject or downweight expired/stale evidence;
- expose missing-family warnings;
- compute a synthesis-ready evidence summary;
- preserve source refs and reasons for inclusion/exclusion;
- keep deterministic market state independently available even when research evidence is absent.

## Scope

In scope:
- application use case / domain logic;
- freshness/confidence weighting;
- inclusion/exclusion reasons;
- tests.

Out of scope:
- external ingest routes;
- final policy synthesis;
- UI.

## Acceptance criteria

- [ ] Fresh, stale, expired, partial, and conflicting evidence scenarios are covered by tests.
- [ ] Research evidence can never silently override deterministic hard guards.
- [ ] The selection result records what was used, what was ignored, and why.
- [ ] Synthesis can proceed in a degraded but explicit mode when research evidence is missing.

## Parent

Part of opsclawd/regime-engine#57.

## Blocked by

- opsclawd/regime-engine#59
