---
title: "Regime-engine deploy-readiness gap: closing the loop with smoke tests, fixtures, runbook, and architecture docs"
date: 2026-04-19
category: documentation-gaps
module: engine
problem_type: documentation_gap
component: documentation
severity: medium
applies_when:
  - deploying regime-engine to Railway or similar PaaS
  - verifying service surface after adding new HTTP endpoints or database tables
  - onboarding operators to the deployment and verification workflow
  - closing a code milestone that added routes without updating operational docs
symptoms:
  - smoke test covers only /health, not the full advertised surface
  - no documented HOST=:: intent for dual-stack binding on Railway
  - no curl-verifiable fixtures for runbook endpoint verification
  - architecture.md out of date with shipped surface (missing endpoints, tables, security posture)
  - no Railway deploy runbook or step-by-step operator guide
  - sprint doc contains assumptions that diverge from implemented reality
root_cause: inadequate_documentation
resolution_type: documentation_update
tags:
  [
    deploy,
    smoke-test,
    runbook,
    railway,
    fixtures,
    architecture,
    regime-engine,
    curl-verification,
    operational-readiness
  ]
---

# Regime-engine deploy-readiness gap: closing the loop with smoke tests, fixtures, runbook, and architecture docs

## Context

When regime-engine reached code-complete across Units 1-5 (plan generation, execution tracking, CLMM event ingestion, S/R levels, weekly reports), it had only a single `/health` smoke test and no operational documentation. A teammate attempting to deploy to Railway would encounter undocumented environment variables (`HOST=::`), no curl-verifiable fixtures to exercise the full API surface, architecture docs that didn't list 3 new endpoints (`/v1/clmm-execution-result`, `/v1/sr-levels`, `/v1/sr-levels/current`) or 2 new tables, and a sprint doc containing stale assumptions (Postgres, reused execution-result route, unconstrained status). The gap between "tests pass locally" and "someone can confidently deploy and verify a running service" was the friction point.

## Guidance

### Expand smoke tests to cover the entire public surface

A `/health` check alone doesn't verify that routes are registered, contracts are wired, or the OpenAPI document is complete. Add tests that assert the OpenAPI doc advertises every expected path — if a route is missing, fix the route registration, not the test.

```typescript
describe("GET /v1/openapi.json", () => {
  it("advertises the documented public surface", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toMatch(/^3\./);
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/health",
        "/version",
        "/v1/plan",
        "/v1/execution-result",
        "/v1/clmm-execution-result",
        "/v1/report/weekly",
        "/v1/sr-levels",
        "/v1/sr-levels/current"
      ])
    );
  });
});
```

### Document environment variables with deploy-scoped intent comments

The `HOST=::` requirement for dual-stack binding on Railway is non-obvious — a local dev default of `0.0.0.0` works everywhere except Railway's private DNS (AAAA-only). Embed the rationale as a code comment and validate it in smoke tests.

```typescript
// src/server.ts — intent comment above the host constant
// Default to 0.0.0.0 for local dev. Production deploys (Railway) must set HOST=::
// so Fastify binds dual-stack (IPv4 + IPv6). Railway's private DNS resolves AAAA
// records; IPv4-only bind causes healthcheck to fail silently.
const host = process.env.HOST ?? "0.0.0.0";
```

Smoke test for dual-stack acceptance (buildApp() doesn't call listen, so it tests the construction path):

```typescript
describe("server HOST handling", () => {
  it("boots when HOST is set to dual-stack '::'", async () => {
    const previous = process.env.HOST;
    process.env.HOST = "::";
    try {
      const fresh = buildApp();
      const response = await fresh.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      await fresh.close();
    } finally {
      if (previous === undefined) {
        delete process.env.HOST;
      } else {
        process.env.HOST = previous;
      }
    }
  });
});
```

### Create deterministic fixtures validated against real parsers

Fixtures for runbook curl verification must parse cleanly through the actual Zod schemas so they stay valid as contracts evolve. Byte-stable fixtures ensure runbook idempotency checks produce predictable output.

```bash
# Validate against real validators — never hand-wave fixture validity
npx tsx -e "import('./src/contract/v1/validation.js').then(async (m) => {
  const fs = await import('node:fs');
  const sr = JSON.parse(fs.readFileSync('fixtures/sr-levels-brief.json','utf8'));
  const ev = JSON.parse(fs.readFileSync('fixtures/clmm-execution-event.json','utf8'));
  m.parseSrLevelBriefRequest(sr);
  m.parseClmmExecutionEventRequest(ev);
  console.log('both fixtures valid');
})"
```

Key fixture constraints:

- `status` must be `"confirmed"` or `"failed"` only (Zod reject on anything else)
- `breachDirection = "LowerBoundBreach"` implies `tokenOut = "USDC"` (validator enforces the mapping)
- ISO 8601 datetimes for `reconciledAtIso` and `detectedAtIso`
- `schemaVersion` must match the CLMM ingest schema contract

### Write a deploy runbook with ordered steps and explicit failure diagnostics

The Railway deploy has a hard ordering dependency: volume must exist before first deploy, `HOST=::` must be set, `LEDGER_DB_PATH` must point to the mounted volume. Each step includes "if this fails, the most likely cause is X." The runbook includes 8 curl checks that walk every endpoint (auth rejection, fresh ingest, read-back, replay idempotency) and a restart-safety check that proves persistence.

Runbook structure (`docs/runbooks/railway-deploy.md`):

1. Create persistent volume FIRST (before first deploy)
2. Set environment variables (table with values + notes)
3. Trigger first deploy (with failure triage)
4. Enable public domain
5. Wire CLMM backend (reference variables for token sharing)
6. Curl verification (8 checks: health, version, openapi, empty read, auth rejection, fresh ingest, read-back, replay idempotency)
7. Private networking verification (with public-URL fallback)
8. Restart safety check (durability proof)
9. End-to-end path (gate to live funding)

### Keep architecture docs in sync by expanding, not rewriting

When endpoints, tables, and security postures change, add new subsections rather than restructuring the whole doc. New data flows (S/R brief ingestion, current S/R read, CLMM execution event ingestion) each get their own subsection under "Data flow". Security posture gets updated with the actual mechanism (shared-secret headers, `timingSafeEqual`, 500 on missing env, append-only ledger with latest-brief rule).

### Annotate sprint docs with resolved assumptions

Rather than rewriting a completed sprint doc, append a "Resolved assumptions" block that lists what changed from the original plan. This preserves the decision trail.

```markdown
## Resolved assumptions (Unit 6 addendum, 2026-04-19)

- Storage engine: SQLite (not Postgres). No DATABASE_URL env var.
- CLMM route: Separate /v1/clmm-execution-result (not reused execution-result).
- Status: Restricted to confirmed | failed (not open set).
- Write model: Append-only ledger + latest-brief rule (not upsert).
- Volume mount: /data on Railway.
- Report integration: Deferred (not in this sprint scope).
```

## Why This Matters

- **Without OpenAPI surface tests**, a misregistered route (e.g., a typo in a Fastify route path or a forgotten `app.register()`) ships silently. The next deploy runbook curl fails and the operator has no signal about what broke.
- **Without `HOST=::` documentation**, Railway deploys pass the build stage and fail the healthcheck with no clear error — the service is "up" but unreachable via private DNS. This is the most common Railway deploy failure and it's preventable by a 2-line comment and a smoke test.
- **Without deterministic fixtures**, curl examples in the runbook drift from the actual contract. A fixture that doesn't parse against the real Zod schema will produce 400s after the next contract change, and the operator won't know if it's a deploy bug or a fixture bug.
- **Without architecture docs reflecting the shipped surface**, a new contributor (or agent) reading `architecture.md` won't know that `sr_level_briefs`, `sr_levels`, or `clmm_execution_events` tables exist, and may add redundant or conflicting schema.
- **Without resolved-assumption annotations**, stale sprint assumptions propagate into future planning — e.g., building for Postgres when the service is SQLite-only.

## When to Apply

- After any milestone that adds new HTTP endpoints or database tables — expand smoke tests and update architecture docs before declaring the milestone done.
- When setting up a PaaS deploy (Railway, Fly, Render) — document the `HOST` bind requirement and any volume-before-deploy ordering with intent comments and runbook steps.
- When creating fixtures for operational runbooks — always validate against real parsers, not hand-crafted JSON.
- When a sprint doc contains assumptions that were validated or invalidated during implementation — annotate rather than rewrite.
- When the security posture changes (new auth headers, new env vars) — update the architecture doc's security section rather than relying on code comments alone.

## Examples

### Before: smoke test covers only /health

```typescript
describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
```

### After: smoke test verifies full public surface + HOST handling

- `/health` — basic liveness
- `/version` — service identity + COMMIT_SHA when set
- `/v1/openapi.json` — all 8 paths advertised
- `HOST=::` — buildApp() accepts dual-stack value

(See Guidance section for full code.)

### Before: README has no deploy verification section

No Railway-specific guidance, no curl commands, no runbook link.

### After: README includes "Verifying the deploy" with curl snippets

Links to `docs/runbooks/railway-deploy.md` for the full 8-check curl sequence plus ordered deploy steps.

### Before: architecture.md lists 2 endpoints, no S/R or CLMM routes, no security detail

### After: architecture.md lists all 8 paths, 3 new data flow subsections, expanded ledger layout, and security posture with shared-secret + timingSafeEqual + append-only model

### Before: Sprint doc says "Postgres via DATABASE_URL" and "reuse /v1/execution-result for CLMM"

### After: Sprint doc has "Resolved assumptions" block

## Related

- [`docs/solutions/best-practices/fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md`](../best-practices/fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md) — Cross-cutting auth/idempotency/transaction patterns for the ingestion endpoints that this deploy readiness doc expects operators to curl
- [`docs/runbooks/railway-deploy.md`](../../runbooks/railway-deploy.md) — The concrete deploy runbook produced by this work
- [`architecture.md`](../../architecture.md) — Updated architecture reflecting the shipped surface
