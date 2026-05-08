---
title: Extract Use Cases Behind Ports to Decouple Handlers from I/O
date: 2026-05-08
category: best-practices
module: application
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - HTTP handler contains business orchestration logic beyond parse/dispatch/map/send
  - Handler directly depends on I/O adapters (ledger writers, candle read ports, clock)
  - Refactoring a handler requires touching infrastructure code or vice versa
tags: [clean-architecture, use-case, ports-adapters, handler-slimming, dependency-injection]
---

# Extract Use Cases Behind Ports to Decouple Handlers from I/O

## Context

HTTP handlers in Fastify route files tend to accumulate orchestration logic: reading config, computing cutoffs, calling I/O ports, branching on derived modes, mapping errors, and writing ledger entries. When a handler owns both "what to do" and "how to do it," any change to the business flow requires touching the HTTP layer, and any change to the HTTP layer risks breaking the business flow. The regime-current handler grew to 107 lines mixing candle-read orchestration, aggregation, error construction, and response building with Fastify request/reply mechanics.

## Guidance

Extract the deterministic orchestration into a **use-case function** behind injected **port interfaces**:

1. Define a port interface in `src/application/ports/` for each I/O dependency (e.g., `PlanLedgerWritePort`, `CandleReadPort`, `ClockPort`).
2. Create a use-case factory in `src/application/use-cases/` that takes port dependencies and returns a typed function `(input) => Promise<output>`.
3. Move all orchestration logic (config lookup, read-plan computation, port calls, aggregation, error throwing) into the use case.
4. Slim the handler to: parse input, call use case, map known errors to HTTP envelopes, send reply.
5. Compose the use case in `routes.ts` — inject real adapters there, pass the use case into the handler factory.

```ts
// src/application/use-cases/getCurrentRegimeUseCase.ts
export const createGetCurrentRegimeUseCase = (
  deps: GetCurrentRegimeUseCaseDeps
): GetCurrentRegimeUseCase => {
  return async (query) => {
    const config = MARKET_REGIME_CONFIG[query.timeframe];
    const nowUnixMs = deps.clock.nowUnixMs();
    const plan = buildRegimeCandleReadPlan({ requestedTimeframe: query.timeframe, nowUnixMs });
    const sourceCandles = await deps.candleReadPort.getLatestCandlesForFeed({ ... });
    if (sourceCandles.length === 0) throw new RegimeCandlesNotFoundError(...);
    // ... aggregation, derived-cutoff filtering, buildRegimeCurrent
    return buildRegimeCurrent({ ... });
  };
};
```

```ts
// src/http/handlers/regimeCurrent.ts (after)
export const createRegimeCurrentHandler = (getCurrentRegime: GetCurrentRegimeUseCase) => {
  return async (request, reply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const response = await getCurrentRegime(query);
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) return reply.code(error.statusCode).send(error.response);
      if (error instanceof RegimeCandlesNotFoundError) { /* map to 404 */ }
      request.log.error(error, "Unhandled error");
      return reply.code(500).send({ ... });
    }
  };
};
```

Key pattern: the handler maps application-layer errors to HTTP envelopes using structural compatibility — the application error detail shape (`{ code, path, message }`) matches the HTTP `ErrorDetail` shape, so a boundary cast (`as ErrorDetail[]`) is the necessary minimum.

## Why This Matters

- **Testability**: Use cases are testable with fake ports (no HTTP server, no database, no Fastify injection). The GetCurrentRegimeUseCase got 5 focused tests covering direct/derived/empty/error paths in <50 lines of fake setup.
- **Boundary enforcement**: `dependency-cruiser` rules already prohibit `src/application/**` from importing `src/http/**`, `src/ledger/**`, `src/adapters/**`, framework npm, or `node:process`. Use cases naturally satisfy these rules because ports are the only external touchpoint.
- **Behavior parity**: Error messages, detail codes, and response shapes are byte-for-byte preserved because the use case copies them from the handler rather than inventing new ones. E2e tests pass unchanged.
- **Composability**: Routes compose the use case with real adapters; tests compose it with fakes. The same use case works behind both SQLite and Postgres candle read adapters.

## When to Apply

- When an HTTP handler exceeds ~50 lines of orchestration logic beyond parse/send
- When the handler directly calls I/O ports or constructs adapter-specific objects
- When you need to unit-test the business flow without spinning up an HTTP server
- When boundary rules (dependency-cruiser, arch-unit) already enforce layer separation

## Examples

Before (107-line handler with mixed concerns):

```ts
export const createRegimeCurrentHandler = (candleReadPort: CandleReadPort) => {
  return async (request, reply) => {
    const query = parseRegimeCurrentQuery(request.query);
    const config = MARKET_REGIME_CONFIG[query.timeframe];
    const nowUnixMs = Date.now();
    const plan = buildRegimeCandleReadPlan({ requestedTimeframe: query.timeframe, nowUnixMs });
    const sourceCandles = await candleReadPort.getLatestCandlesForFeed({ ... });
    if (sourceCandles.length === 0) throw candlesNotFoundError(...);
    // ... 60 more lines of aggregation, filtering, buildRegimeCurrent
    return reply.code(200).send(response);
  };
};
```

After (handler: ~30 lines, use case: ~80 lines but fully testable):

```ts
// Handler — parse, dispatch, map errors, send
export const createRegimeCurrentHandler = (getCurrentRegime: GetCurrentRegimeUseCase) => { ... };

// Use case — fully testable with fakes
export const createGetCurrentRegimeUseCase = (deps) => async (query) => { ... };

// Routes — composition root
const getCurrentRegime = createGetCurrentRegimeUseCase({ candleReadPort, clock, engineVersion });
app.get("/v1/regime/current", createRegimeCurrentHandler(getCurrentRegime));
```

## Related

- `src/application/ports/` — port interfaces defining I/O boundaries
- `src/application/use-cases/` — use-case factories with port injection
- `.dependency-cruiser.cjs` — boundary rules enforcing layer separation
