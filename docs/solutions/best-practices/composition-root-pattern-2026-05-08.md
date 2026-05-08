---
title: Composition Root Pattern for Fastify Dependency Wiring
date: 2026-05-08
category: best-practices
module: composition
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - Route registration file constructs stores, adapters, and use cases inline
  - Handler tests need manual Fastify setup with store/environment plumbing
  - Adding a new I/O dependency requires touching routes.ts wiring
tags: [composition-root, dependency-injection, fastify, handler-slimming, clean-architecture]
---

# Composition Root Pattern for Fastify Dependency Wiring

## Context

In the regime-engine codebase, `src/http/routes.ts` accumulated 133 lines of infrastructure wiring: reading env vars, constructing `LedgerStore`/`StoreContext`, creating adapter instances, building use cases, and registering routes. Handlers took `LedgerStore` directly and performed application logic (error mapping, outcome branching). This made handler tests require real or mock stores, and made e2e tests fragile around environment-variable setup.

The m40 milestone introduced execution-reporting use cases (RecordExecutionResult, RecordClmmExecutionResult, GetWeeklyReport) that needed ledger and report ports. Rather than adding more wiring to routes.ts, we extracted a dedicated composition root.

## Guidance

Separate infrastructure composition into `src/composition/` with three focused modules:

1. **`buildStoreContext.ts`** — Reads env vars (`DATABASE_URL`, `COMMIT_SHA`), selects SQLite vs PG store, returns a `RuntimeStoreContext` with a `close()` method. This is the only module that touches `process.env` or node:process.

2. **`buildApplication.ts`** — Takes a `RuntimeStoreContext`, constructs ports → adapters → use cases, returns `ApplicationDependencies` (use-case functions + `checkHealth` + `versionInfo`). Pure plumbing, no HTTP or env.

3. **`buildApp.ts`** — Creates the Fastify server, calls `buildStoreContext` + `buildApplication`, passes `deps` to `registerRoutes(app, deps)`, attaches `onClose` cleanup. This is the single entry point.

```ts
// src/composition/buildApplication.ts
export interface ApplicationDependencies {
  recordExecutionResult: RecordExecutionResultUseCase;
  recordClmmExecutionResult: RecordClmmExecutionResultUseCase;
  getWeeklyReport: GetWeeklyReportUseCase;
  checkHealth: () => Promise<HealthCheckResult>;
  versionInfo: () => { version: string; commitSha: string };
}

export const buildApplication = (storeContext: RuntimeStoreContext): ApplicationDependencies => {
  const executionResultWritePort = new SqliteExecutionLedgerAdapter(storeContext.store);
  const weeklyReportReadPort = new SqliteWeeklyReportReadAdapter(storeContext.store);

  return {
    recordExecutionResult: createRecordExecutionResultUseCase({ executionResultWritePort }),
    recordClmmExecutionResult: createRecordClmmExecutionResultUseCase({ executionResultWritePort }),
    getWeeklyReport: createGetWeeklyReportUseCase({ weeklyReportReadPort }),
    checkHealth: () => storeContext.store.checkHealth(),
    versionInfo: () => ({ version: VERSION, commitSha: storeContext.commitSha })
  };
};
```

```ts
// src/http/routes.ts (after)
export const registerRoutes = (app: FastifyInstance, deps: ApplicationDependencies): void => {
  app.post("/v1/execution-result", createExecutionResultHandler(deps.recordExecutionResult));
  app.post(
    "/v1/clmm-execution-result",
    createClmmExecutionResultHandler(deps.recordClmmExecutionResult)
  );
  app.get("/v1/weekly-report", createReportHandler(deps.getWeeklyReport));
  // ...health, version, openapi
};
```

The handler signature changes from receiving a store/port to receiving a use-case function:

```ts
// Before: handler owned error mapping + store calls
export const createExecutionResultHandler = (store: LedgerStore) => async (req, reply) => { ... };

// After: handler delegates to use case, maps application errors to HTTP
export const createExecutionResultHandler = (useCase: RecordExecutionResultUseCase) => async (req, reply) => {
  try {
    const result = await useCase(body);
    return reply.code(200).send(result);
  } catch (error) {
    if (error instanceof ExecutionResultPlanNotFoundError) return reply.code(404).send(...);
    if (error instanceof ExecutionResultConflictError) return reply.code(409).send(...);
  }
};
```

## Why This Matters

- **`routes.ts` is now pure registration** — no env reads, no store construction, no adapter wiring. 40 lines down from 133.
- **Handler tests use `buildApp()` directly** — no manual Fastify + store + env setup. The health-probe test went from 12 lines of plumbing to `const app = await buildApp()`.
- **E2e composition tests** — `buildApp.e2e.test.ts` exercises the full wiring (store → adapter → use case → handler → route) in 30 lines.
- **New use cases cost one line each** — add port to `buildApplication`, add use case to `ApplicationDependencies`, add route in `registerRoutes`.

## When to Apply

- When route registration does more than register routes (env reads, store construction, adapter wiring)
- When handler tests need extensive store/environment setup that obscures the test intent
- When adding use cases requires modifying multiple unrelated files just to wire them in
- When the same dependency graph is reconstructed in multiple places (routes.ts, tests, scripts)

## Examples

Before — routes.ts handled everything:

```ts
// src/http/routes.ts (133 lines)
export const registerRoutes = async (app: FastifyInstance) => {
  const store = createLedgerStore(dbPath);
  const executionResultWritePort = new SqliteExecutionLedgerAdapter(store);
  const recordExecutionResult = createRecordExecutionResultUseCase({ executionResultWritePort });
  // ... more wiring ...
  app.post("/v1/execution-result", createExecutionResultHandler(recordExecutionResult));
};
```

After — composition root owns wiring, routes is pure registration:

```ts
// src/composition/buildApp.ts (20 lines)
export const buildApp = async () => {
  const storeContext = buildStoreContext();
  const deps = buildApplication(storeContext);
  const app = fastify();
  registerRoutes(app, deps);
  app.addHook("onClose", async () => {
    await storeContext.close();
  });
  return app;
};

// src/http/routes.ts (40 lines)
export const registerRoutes = (app: FastifyInstance, deps: ApplicationDependencies): void => {
  app.post("/v1/execution-result", createExecutionResultHandler(deps.recordExecutionResult));
  // ... pure registration, zero construction ...
};
```

## Related

- `docs/solutions/best-practices/extract-use-cases-behind-ports-2026-05-08.md` — the use-case extraction pattern that this composition root wires together
- `src/composition/` — buildStoreContext, buildApplication, buildApp
- `src/application/ports/` — port interfaces the composition root connects
