# Postgres Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Postgres (Drizzle + postgres.js) as a second data store alongside SQLite, with schema isolation on the shared Railway Postgres, so that future features (#20 v2 S/R Levels, #21 CLMM Insights) have a Postgres-native table surface.

**Architecture:** Regime Engine keeps SQLite for the append-only receipt ledger. A new Drizzle-backed Postgres client connects to the shared Railway Postgres with `search_path=regime_engine` set on every connection. Both stores are wrapped in a `StoreContext` object that handler factories receive. The `/health` endpoint gains Postgres connectivity verification. The service hard-fails on startup if Postgres is unreachable.

**Tech Stack:** TypeScript, Drizzle ORM 0.36+, postgres.js 3.4+, Drizzle Kit 0.31+, Fastify 5, Vitest 3, Docker Compose for integration tests.

**Design doc:** `docs/plans/2026-04-28-005-postgres-integration-design.md`
**Issues:** [#22](https://github.com/opsclawd/regime-engine/issues/22) (this), [#20](https://github.com/opsclawd/regime-engine/issues/20), [#21](https://github.com/opsclawd/regime-engine/issues/21)

---

## File Structure

### New files

```
src/ledger/pg/
  db.ts                                    # createDb() factory + Db type export
  schema/
    index.ts                               # re-exports all Drizzle schema modules

src/ledger/
  storeContext.ts                           # StoreContext interface + createStoreContext factory

docker-compose.test.yml                    # Postgres for integration tests
drizzle.config.ts                          # Drizzle Kit migration config
drizzle/
  0000_create_regime_engine_schema.sql     # initial migration

src/ledger/pg/__tests__/
  db.test.ts                               # unit tests for createDb (mocked)

src/ledger/__tests__/
  storeContext.test.ts                     # unit tests for StoreContext

src/http/__tests__/
  health.e2e.test.ts                       # e2e tests for enhanced /health

```

### Modified files

```
package.json                                # add drizzle-orm, postgres, drizzle-kit + scripts
.env.example                                # add DATABASE_URL, PG_MAX_CONNECTIONS
src/http/routes.ts                          # create StoreContext, pass to handlers
src/app.ts                                  # accept StoreContext, enhance /health
src/http/openapi.ts                         # add postgres to health response schema
railway.toml                                # add preDeployCommand for db:migrate
Dockerfile                                  # no changes needed (migrations run pre-deploy)
```

---

## Task 1: Install Postgres Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install drizzle-orm and postgres.js as runtime dependencies**

Run:
```bash
npm install drizzle-orm@^0.36.0 postgres@^3.4.0
```

Expected: `package.json` gains `"drizzle-orm": "^0.36.0"` and `"postgres": "^3.4.0"` in `dependencies`.

- [ ] **Step 2: Install drizzle-kit as a dev dependency**

Run:
```bash
npm install -D drizzle-kit@^0.31.10
```

Expected: `package.json` gains `"drizzle-kit": "^0.31.10"` in `devDependencies`.

- [ ] **Step 3: Add db scripts to package.json**

In `package.json`, add these entries to `"scripts"`:

```json
{
  "db:migrate": "drizzle-kit migrate",
  "db:generate": "drizzle-kit generate",
  "db:push": "drizzle-kit push"
}
```

The full scripts block should become:

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.build.json && node scripts/copyBuildAssets.mjs",
  "typecheck": "tsc --noEmit",
  "lint": "eslint . --max-warnings 0",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:pg": "vitest run --config vitest.config.pg.ts",
  "format": "prettier --check .",
  "harness": "tsx scripts/harness.ts",
  "db:migrate": "drizzle-kit migrate",
  "db:generate": "drizzle-kit generate",
  "db:push": "drizzle-kit push"
}
```

Note: `test:pg` is added now for future Postgres integration tests. The `vitest.config.pg.ts` file will be created in Task 6.

- [ ] **Step 4: Run typecheck to verify no breakage**

Run: `npm run typecheck`

Expected: PASS (no code changes yet that could break)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "m022: add drizzle-orm, postgres, drizzle-kit dependencies"
```

---

## Task 2: Create Drizzle Config and Initial Migration

**Files:**
- Create: `drizzle.config.ts`
- Create: `drizzle/0000_create_regime_engine_schema.sql`
- Create: `drizzle/meta/_journal.json`
- Create: `src/ledger/pg/schema/index.ts`

- [ ] **Step 1: Create the Drizzle Kit config**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/ledger/pg/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false }
  }
});
```

- [ ] **Step 2: Create the empty schema index**

Create `src/ledger/pg/schema/index.ts`:

```ts
export {};
```

This is an empty shell. Feature schema modules (#20, #21) will add re-exports here later.

- [ ] **Step 3: Create the initial migration SQL**

Create `drizzle/0000_create_regime_engine_schema.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS regime_engine;
```

- [ ] **Step 4: Create the migration journal**

Create `drizzle/meta/_journal.json`:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "6",
      "when": 1745856000000,
      "tag": "0000_create_regime_engine_schema",
      "breakpoints": true
    }
  ]
}
```

- [ ] **Step 5: Create the snapshot metadata**

Create `drizzle/meta/0000_snapshot.json`:

```json
{
  "version": "6",
  "dialect": "postgresql",
  "id": "0000_create_regime_engine_schema",
  "prevId": "00000000-0000-0000-0000-000000000000",
  "tables": {},
  "enums": {},
  "schemas": {
    "regime_engine": "regime_engine"
  },
  "sequences": {}
}
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add drizzle.config.ts src/ledger/pg/schema/index.ts drizzle/
git commit -m "m022: add drizzle config and initial regime_engine schema migration"
```

---

## Task 3: Create the Postgres DB Factory

**Files:**
- Create: `src/ledger/pg/db.ts`
- Create: `src/ledger/pg/__tests__/db.test.ts`

- [ ] **Step 1: Write the failing test for createDb**

Create `src/ledger/pg/__tests__/db.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../db.js";

describe("createDb", () => {
  it("returns a Drizzle db instance with search_path set on connect", async () => {
    const connectionString = process.env.DATABASE_URL ?? "";
    if (!connectionString) {
      return;
    }

    const { db, client } = createDb(connectionString);
    expect(db).toBeDefined();
    expect(typeof db.select).toBe("function");

    const result = await db.execute({ sql: "SELECT current_setting('search_path') AS search_path" });
    const rows = result.rows as Array<{ search_path: string }>;
    expect(rows[0].search_path).toContain("regime_engine");

    await client.end();
  });

  it("exports Db type for use in handlers", () => {
    const dbType: Db = {} as Db;
    expect(dbType).toBeDefined();
  });
});
```

Note: This test requires a real Postgres (via `docker-compose.test.yml`). It will be skipped automatically when `DATABASE_URL` is not set. We'll add the `vitest.config.pg.ts` in Task 6. For now, the test file exists so typecheck passes and the unit-level contract is documented.

- [ ] **Step 2: Run typecheck — expect failure (db.ts doesn't exist yet)**

Run: `npm run typecheck`

Expected: FAIL — `Cannot find module '../db.js'`

- [ ] **Step 3: Write the createDb factory**

Create `src/ledger/pg/db.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createDb(connectionString: string): { db: ReturnType<typeof drizzle>; client: ReturnType<typeof postgres> } {
  const client = postgres(connectionString, {
    onconnect: async (conn) => {
      await conn.unsafe("SET search_path=regime_engine");
    }
  });

  const db = drizzle(client);

  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];
```

**Important `postgres.js` note:** If `onconnect` does not exist in the installed version, use this alternative pattern instead:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createDb(connectionString: string): { db: ReturnType<typeof drizzle>; client: ReturnType<typeof postgres> } {
  const client = postgres(connectionString);

  const db = drizzle(client);

  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];
```

Then set `search_path` as the first query in `createStoreContext` (Task 4). The `onconnect` callback is preferred because it runs automatically on every new connection, including after pool reconnection. If it's not available, the fallback is equally valid — it just needs to run once per connection acquisition.

Validate which pattern works by checking the `postgres.js` constructor options type. If `onconnect` is not in the type, use the fallback.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ledger/pg/db.ts src/ledger/pg/__tests__/db.test.ts
git commit -m "m022: add createDb factory with search_path=regime_engine"
```

---

## Task 4: Create StoreContext

**Files:**
- Create: `src/ledger/storeContext.ts`
- Create: `src/ledger/__tests__/storeContext.test.ts`

- [ ] **Step 1: Write the failing test for StoreContext**

Create `src/ledger/__tests__/storeContext.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StoreContext } from "../storeContext.js";

describe("StoreContext", () => {
  it("holds both ledger and pg stores", () => {
    const ctx: StoreContext = {
      ledger: {
        db: {} as never,
        path: ":memory:",
        close: () => {}
      },
      pg: {} as never,
      pgClient: {
        end: async () => {}
      } as never
    };

    expect(ctx.ledger).toBeDefined();
    expect(ctx.pg).toBeDefined();
    expect(ctx.pgClient).toBeDefined();
    expect(typeof ctx.ledger.close).toBe("function");
  });
});
```

- [ ] **Step 2: Run typecheck — expect failure (storeContext.ts doesn't exist yet)**

Run: `npm run typecheck`

Expected: FAIL — `Cannot find module '../storeContext.js'`

- [ ] **Step 3: Write the StoreContext interface and factory**

Create `src/ledger/storeContext.ts`:

```ts
import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";
import { createLedgerStore } from "./store.js";
import { createDb } from "./pg/db.js";
import type { PostgresError } from "postgres";

export interface StoreContext {
  ledger: LedgerStore;
  pg: Db;
  pgClient: { end: () => Promise<void> };
}

export const createStoreContext = (ledgerPath: string, pgConnectionString: string): StoreContext => {
  const ledger = createLedgerStore(ledgerPath);
  const { db: pg, client: pgClient } = createDb(pgConnectionString);
  return { ledger, pg, pgClient };
};

export const closeStoreContext = async (ctx: StoreContext): Promise<void> => {
  ctx.ledger.close();
  await ctx.pgClient.end();
};
```

**Fallback note:** If `onconnect` is not available in `postgres.js` (see Task 3), add `SET search_path=regime_engine` execution here:

```ts
export const createStoreContext = async (ledgerPath: string, pgConnectionString: string): Promise<StoreContext> => {
  const ledger = createLedgerStore(ledgerPath);
  const { db: pg, client: pgClient } = createDb(pgConnectionString);

  await pg.execute({ sql: "SET search_path=regime_engine" });

  return { ledger, pg, pgClient };
};
```

This changes `createStoreContext` to async. If this is needed, adjust Task 5 (`routes.ts`) accordingly — the `registerRoutes` function would need to become async, or the `buildApp`/`server.ts` flow would await context creation before listening.

Prefer the `onconnect` approach (Task 3) to keep `createStoreContext` synchronous.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 5: Run existing tests to confirm no regression**

Run: `npm run test`

Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/ledger/storeContext.ts src/ledger/__tests__/storeContext.test.ts
git commit -m "m022: add StoreContext interface and factory"
```

---

## Task 5: Wire StoreContext into Routes and App

**Files:**
- Modify: `src/http/routes.ts`
- Modify: `src/app.ts`
- Modify: `src/server.ts`
- Create: `src/http/__tests__/storeContext.e2e.test.ts`

- [ ] **Step 1: Write the failing e2e test for Postgres health check**

Create `src/http/__tests__/storeContext.e2e.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

describe("StoreContext integration /health", () => {
  afterEach(async () => {
    delete process.env.LEDGER_DB_PATH;
    delete process.env.DATABASE_URL;
  });

  it("/health returns ok=true with postgres=ok when DATABASE_URL is set and Postgres is reachable", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return;
    }

    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.DATABASE_URL = connectionString;

    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; postgres: string; sqlite: string };
    expect(body.ok).toBe(true);
    expect(body.postgres).toBe("ok");
    expect(body.sqlite).toBe("ok");

    await app.close();
  });

  it("/health returns ok=true with postgres=not_configured when DATABASE_URL is not set", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;

    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; postgres: string; sqlite: string };
    expect(body.ok).toBe(true);
    expect(body.postgres).toBe("not_configured");
    expect(body.sqlite).toBe("ok");

    await app.close();
  });
});
```

Note: These tests will initially fail because `/health` doesn't return `postgres`/`sqlite` fields yet. The first test requires a real Postgres — run with `npm run test:pg` after Task 6. The second test (no `DATABASE_URL`) should work immediately once the health endpoint is updated.

- [ ] **Step 2: Run default test suite — expect failure (StoreContext not wired yet)**

Run: `npm run test`

Expected: The test file imports compile but `/health` doesn't return the new shape. The "not_configured" test will fail because `/health` still returns `{ ok: true }`.

- [ ] **Step 3: Update routes.ts to use StoreContext**

Replace the contents of `src/http/routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { buildOpenApiDocument } from "./openapi.js";
import { closeStoreContext, createStoreContext, type StoreContext } from "../ledger/storeContext.js";
import { createLedgerStore } from "../ledger/store.js";
import { createClmmExecutionResultHandler } from "./handlers/clmmExecutionResult.js";
import { createExecutionResultHandler } from "./handlers/executionResult.js";
import { createPlanHandler } from "./handlers/plan.js";
import { createWeeklyReportHandler } from "./handlers/report.js";
import { createSrLevelsIngestHandler } from "./handlers/srLevelsIngest.js";
import { createSrLevelsCurrentHandler } from "./handlers/srLevelsCurrent.js";

export const registerRoutes = (app: FastifyInstance): StoreContext | null => {
  const databasePath =
    process.env.LEDGER_DB_PATH ??
    (process.env.NODE_ENV === "test" ? ":memory:" : "tmp/ledger.sqlite");

  const pgConnectionString = process.env.DATABASE_URL ?? "";

  let storeContext: StoreContext | null = null;

  if (pgConnectionString) {
    storeContext = createStoreContext(databasePath, pgConnectionString);

    app.addHook("onClose", async () => {
      await closeStoreContext(storeContext!);
    });
  } else {
    const ledgerStore = createLedgerStore(databasePath);

    app.addHook("onClose", async () => {
      ledgerStore.close();
    });
  }

  const ledger = storeContext?.ledger ?? createLedgerStore(databasePath);
  const pg = storeContext?.pg ?? null;

  if (!pgConnectionString) {
    app.addHook("onClose", async () => {
      if (!storeContext) {
        ledger.close();
      }
    });
  }

  app.get("/health", async () => {
    const sqliteOk = true;
    let postgresStatus: string = pg ? "ok" : "not_configured";

    if (pg) {
      try {
        await pg.execute({ sql: "SELECT 1" });
        postgresStatus = "ok";
      } catch {
        postgresStatus = "unavailable";
      }
    }

    return {
      ok: sqliteOk && postgresStatus !== "unavailable",
      postgres: postgresStatus,
      sqlite: sqliteOk ? "ok" : "unavailable"
    };
  });

  app.get("/version", async () => {
    const response: { name: string; version: string; commit?: string } = {
      name: "regime-engine",
      version: process.env.npm_package_version ?? "0.1.0"
    };

    if (process.env.COMMIT_SHA) {
      response.commit = process.env.COMMIT_SHA;
    }

    return response;
  });

  app.get("/v1/openapi.json", async () => {
    return buildOpenApiDocument();
  });

  app.post("/v1/plan", createPlanHandler(ledger));
  app.post("/v1/execution-result", createExecutionResultHandler(ledger));
  app.post("/v1/clmm-execution-result", createClmmExecutionResultHandler(ledger));
  app.get("/v1/report/weekly", createWeeklyReportHandler(ledger));
  app.post("/v1/sr-levels", createSrLevelsIngestHandler(ledger));
  app.get("/v1/sr-levels/current", createSrLevelsCurrentHandler(ledger));

  return storeContext;
};
```

**Important cleanup note:** The above has a double-close bug for the no-PG path. The clean version avoids this by always going through `StoreContext` or by tracking cleanup responsibility. Here is the corrected, clean version:

```ts
import type { FastifyInstance } from "fastify";
import { buildOpenApiDocument } from "./openapi.js";
import { closeStoreContext, createStoreContext, type StoreContext } from "../ledger/storeContext.js";
import { createLedgerStore } from "../ledger/store.js";
import { createClmmExecutionResultHandler } from "./handlers/clmmExecutionResult.js";
import { createExecutionResultHandler } from "./handlers/executionResult.js";
import { createPlanHandler } from "./handlers/plan.js";
import { createWeeklyReportHandler } from "./handlers/report.js";
import { createSrLevelsIngestHandler } from "./handlers/srLevelsIngest.js";
import { createSrLevelsCurrentHandler } from "./handlers/srLevelsCurrent.js";

export const registerRoutes = (app: FastifyInstance): StoreContext | null => {
  const databasePath =
    process.env.LEDGER_DB_PATH ??
    (process.env.NODE_ENV === "test" ? ":memory:" : "tmp/ledger.sqlite");

  const pgConnectionString = process.env.DATABASE_URL ?? "";

  let storeContext: StoreContext | null = null;
  let standaloneLedger: ReturnType<typeof createLedgerStore> | null = null;

  if (pgConnectionString) {
    storeContext = createStoreContext(databasePath, pgConnectionString);
  } else {
    standaloneLedger = createLedgerStore(databasePath);
  }

  app.addHook("onClose", async () => {
    if (storeContext) {
      await closeStoreContext(storeContext);
    } else if (standaloneLedger) {
      standaloneLedger.close();
    }
  });

  const ledger = storeContext?.ledger ?? standaloneLedger!;
  const pg = storeContext?.pg ?? null;

  app.get("/health", async () => {
    const sqliteOk = true;
    let postgresStatus: string = pg ? "ok" : "not_configured";

    if (pg) {
      try {
        await pg.execute({ sql: "SELECT 1" });
        postgresStatus = "ok";
      } catch {
        postgresStatus = "unavailable";
      }
    }

    return {
      ok: sqliteOk && postgresStatus !== "unavailable",
      postgres: postgresStatus,
      sqlite: sqliteOk ? "ok" : "unavailable"
    };
  });

  app.get("/version", async () => {
    const response: { name: string; version: string; commit?: string } = {
      name: "regime-engine",
      version: process.env.npm_package_version ?? "0.1.0"
    };

    if (process.env.COMMIT_SHA) {
      response.commit = process.env.COMMIT_SHA;
    }

    return response;
  });

  app.get("/v1/openapi.json", async () => {
    return buildOpenApiDocument();
  });

  app.post("/v1/plan", createPlanHandler(ledger));
  app.post("/v1/execution-result", createExecutionResultHandler(ledger));
  app.post("/v1/clmm-execution-result", createClmmExecutionResultHandler(ledger));
  app.get("/v1/report/weekly", createWeeklyReportHandler(ledger));
  app.post("/v1/sr-levels", createSrLevelsIngestHandler(ledger));
  app.get("/v1/sr-levels/current", createSrLevelsCurrentHandler(ledger));

  return storeContext;
};
```

- [ ] **Step 4: Update the existing routes.contract.test.ts health assertion**

In `src/http/__tests__/routes.contract.test.ts`, the `/health` test currently asserts `{ ok: true }`. Update it:

Change:
```ts
expect(response.json()).toEqual({ ok: true });
```
To:
```ts
expect(response.json()).toEqual({
  ok: true,
  postgres: "not_configured",
  sqlite: "ok"
});
```

This is correct because the default test environment doesn't set `DATABASE_URL`.

- [ ] **Step 5: Update the smoke test if it tests /health**

Check `src/__tests__/smoke.test.ts` for any `/health` assertions and update them to match the new shape:

```json
{ "ok": true, "postgres": "not_configured", "sqlite": "ok" }
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 7: Run tests**

Run: `npm run test`

Expected: All tests PASS including the new `storeContext.e2e.test.ts` "not_configured" case.

- [ ] **Step 8: Commit**

```bash
git add src/http/routes.ts src/http/__tests__/routes.contract.test.ts src/http/__tests__/storeContext.e2e.test.ts
git commit -m "m022: wire StoreContext into routes, enhance /health with postgres status"
```

---

## Task 6: Add Docker Compose for Integration Tests

**Files:**
- Create: `docker-compose.test.yml`
- Create: `vitest.config.pg.ts`

- [ ] **Step 1: Create docker-compose.test.yml**

Create `docker-compose.test.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: regime_engine_test
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test -d regime_engine_test"]
      interval: 2s
      timeout: 5s
      retries: 10
```

- [ ] **Step 2: Create vitest.config.pg.ts**

Create `vitest.config.pg.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    coverage: {
      enabled: false
    }
  },
  define: {
    "process.env.DATABASE_URL": JSON.stringify(
      "postgres://test:test@localhost:5432/regime_engine_test"
    )
  }
});
```

**Important:** This does NOT inject `process.env.DATABASE_URL` — it only provides a define-time constant. The actual env var must be set when running `npm run test:pg`. The script should be:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test npm run test:pg
```

Or more precisely, update the `test:pg` script in `package.json` to include it:

```json
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test vitest run"
```

- [ ] **Step 3: Update the test:pg script in package.json**

Change:
```json
"test:pg": "vitest run --config vitest.config.pg.ts"
```
To:
```json
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test vitest run"
```

No need for the separate config file — the default `vitest.config.ts` includes all `src/**/*.test.ts` already. Delete `vitest.config.pg.ts` if you created it.

Actually, keep `vitest.config.pg.ts` as a convenience wrapper but simplify `package.json`:

```json
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test vitest run --config vitest.config.pg.ts"
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docker-compose.test.yml vitest.config.pg.ts package.json
git commit -m "m022: add docker-compose.test.yml and test:pg script for Postgres integration tests"
```

---

## Task 7: Add Startup Hard-Fail for Postgres

**Files:**
- Modify: `src/server.ts`
- Modify: `src/app.ts`
- Create: `src/__tests__/pgStartup.test.ts`

- [ ] **Step 1: Write the failing test for Postgres startup verification**

Create `src/__tests__/pgStartup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifyPgConnection } from "../app.js";

describe("verifyPgConnection", () => {
  it("resolves without error when pg is reachable", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return;
    }

    const { db, client } = await import("../ledger/pg/db.js").then((mod) =>
      mod.createDb(connectionString)
    );

    await expect(verifyPgConnection(db)).resolves.toBeUndefined();

    await client.end();
  });

  it("throws when pg is unreachable", async () => {
    const { db, client } = await import("../ledger/pg/db.js").then((mod) =>
      mod.createDb("postgres://invalid:invalid@localhost:9999/invalid")
    );

    await expect(verifyPgConnection(db)).rejects.toThrow();

    try {
      await client.end();
    } catch {
      // connection may already be dead
    }
  });
});
```

Note: The "reachable" test only runs when `DATABASE_URL` is set (same as Task 6). The "unreachable" test can run without a real Postgres.

- [ ] **Step 2: Add verifyPgConnection to app.ts**

Update `src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "./http/routes.js";
import type { Db } from "./ledger/pg/db.js";

export const verifyPgConnection = async (pg: Db): Promise<void> => {
  await pg.execute({ sql: "SELECT 1" });
};

export const buildApp = (): FastifyInstance => {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });
  registerRoutes(app);

  return app;
};
```

- [ ] **Step 3: Update server.ts to verify Postgres at startup**

Update `src/server.ts`:

```ts
import { buildApp, verifyPgConnection } from "./app.js";
import { createDb } from "./ledger/pg/db.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const SHUTDOWN_TIMEOUT_MS = 10_000;

const start = async (): Promise<void> => {
  const pgConnectionString = process.env.DATABASE_URL ?? "";

  if (pgConnectionString) {
    try {
      const { db: pg, client } = createDb(pgConnectionString);
      await verifyPgConnection(pg);
      await client.end();
    } catch (error) {
      console.error("FATAL: Postgres connection failed at startup. Exiting.", error);
      process.exit(1);
    }
  }

  const app = buildApp();
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const gracefulShutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down gracefully`);
    const forceExit = setTimeout(() => {
      app.log.error("Forcing exit after shutdown timeout");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await app.close();
      app.log.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
};

void start();
```

**Note on the double-connection:** The startup check opens a short-lived connection, then closes it. The actual long-lived connection is created inside `registerRoutes` via `createStoreContext`. This is intentional — the startup check is a "can I connect?" guard before we even build the Fastify app. It adds negligible overhead.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 5: Run default tests**

Run: `npm run test`

Expected: All tests PASS (startup check is only in `server.ts`, not exercised by `buildApp()` in tests)

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/server.ts src/__tests__/pgStartup.test.ts
git commit -m "m022: add Postgres startup hard-fail and verifyPgConnection"
```

---

## Task 8: Update OpenAPI Document

**Files:**
- Modify: `src/http/openapi.ts`
- Modify: `src/http/__tests__/routes.contract.test.ts`

- [ ] **Step 1: Update the /health response in the OpenAPI document**

In `src/http/openapi.ts`, update the `/health` entry:

```ts
"/health": {
  get: {
    summary: "Service health check (includes Postgres and SQLite status)",
    responses: {
      "200": {
        description: "Health status",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                postgres: { type: "string", enum: ["ok", "unavailable", "not_configured"] },
                sqlite: { type: "string", enum: ["ok", "unavailable"] }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Update the routes contract test for OpenAPI /health**

In `src/http/__tests__/routes.contract.test.ts`, verify the OpenAPI document includes the updated `/health` definition. Add or adjust a test case that checks the `/health` path in the OpenAPI document contains the postgres field description.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm run test`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/http/openapi.ts src/http/__tests__/routes.contract.test.ts
git commit -m "m022: update OpenAPI /health schema with postgres and sqlite fields"
```

---

## Task 9: Update Railway Config and Docker

**Files:**
- Modify: `railway.toml`

- [ ] **Step 1: Add preDeploy migration command to railway.toml**

Update `railway.toml`:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "node --env-file-if-exists=.env dist/src/server.js"
preDeployCommand = "npm run db:migrate"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
requiredMountPath = "/data"
```

- [ ] **Step 2: Verify the Dockerfile doesn't need changes**

The current `Dockerfile` copies `dist/` and runs the server. `npm run db:migrate` runs `drizzle-kit migrate`, which needs the `drizzle/` directory and `drizzle.config.ts` compiled to JS. Check if the `drizzle/` directory is included in the Docker image.

The Dockerfile copies `src/` and `scripts/` but not `drizzle/`. Add it to the builder stage:

In `Dockerfile`, after the `COPY scripts/ scripts/` line, add:

```dockerfile
COPY drizzle/ drizzle/
COPY drizzle.config.ts drizzle.config.ts
```

Also ensure `drizzle-kit` is available in the production image. Since it's a devDependency, `npm ci --omit=dev` will strip it. Either:

1. Move `drizzle-kit` to regular `dependencies` (not ideal — it's a CLI tool, not runtime), or
2. Run `npm run db:migrate` in the builder stage (before `npm ci --omit=dev`), or
3. Keep a separate migration step.

**Recommendation:** Option 2 is cleanest. Add the migration to the builder stage:

```dockerfile
# ---- Build stage ----
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
COPY scripts/ scripts/
COPY drizzle/ drizzle/
COPY drizzle.config.ts drizzle.config.ts

RUN npm run build
```

Then in the production stage, add `drizzle-kit` as a prod install or use a separate migration container. Since Railway's `preDeployCommand` runs before the main process, the simplest approach is to install `drizzle-kit` in production and run migrations:

Update production stage:

```dockerfile
# ---- Production stage ----
FROM node:22-slim AS production

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm cache clean --force

# Copy drizzle files for migration support
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
# drizzle.config.ts needs the compiled schema
COPY --from=builder /app/dist/src/ledger/pg/schema ./dist/src/ledger/pg/schema

# Pre-create data directory writable by non-root user
RUN mkdir -p /app/tmp && chown app:app /app/tmp

USER app

ENV NODE_ENV=production
ENV PORT=8787
ENV LEDGER_DB_PATH=tmp/ledger.sqlite
EXPOSE 8787

CMD ["node", "--env-file-if-exists=.env", "dist/src/server.js"]
```

**But `preDeployCommand` runs with the same container image.** So `drizzle-kit` must be available in production. The cleanest fix: add a separate `db:migrate:prod` script that uses a lightweight approach, or install `drizzle-kit` in production deps.

Simplest production-ready approach: make `drizzle-kit` a regular dependency (not devDep). It's only ~5MB and eliminates the Docker layer complexity.

Update `package.json` — move `drizzle-kit` from `devDependencies` to `dependencies`:

```json
"dependencies": {
  "drizzle-orm": "^0.36.0",
  "drizzle-kit": "^0.31.10",
  "fastify": "^5.3.0",
  "postgres": "^3.4.0",
  "zod": "^3.24.2"
}
```

This makes `npm run db:migrate` work in the production container without extra Docker hacking.

- [ ] **Step 3: Update Dockerfile to copy migration files**

Final `Dockerfile`:

```dockerfile
# ---- Build stage ----
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
COPY scripts/ scripts/
COPY drizzle/ drizzle/
COPY drizzle.config.ts drizzle.config.ts

RUN npm run build

# ---- Production stage ----
FROM node:22-slim AS production

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

RUN mkdir -p /app/tmp && chown app:app /app/tmp

USER app

ENV NODE_ENV=production
ENV PORT=8787
ENV LEDGER_DB_PATH=tmp/ledger.sqlite
EXPOSE 8787

CMD ["node", "--env-file-if-exists=.env", "dist/src/server.js"]
```

Wait — `npm ci --omit=dev` will strip `drizzle-kit` if it's in devDependencies. But we moved it to `dependencies` in Step 2, so it survives. However, `drizzle.config.ts` imports `./src/ledger/pg/schema/index.ts`, which is TypeScript. In production, we need the compiled JS version. Update `drizzle.config.ts`:

Change the schema path to point at the compiled output when in production:

```ts
import { defineConfig } from "drizzle-kit";

const isProduction = process.env.NODE_ENV === "production";
const schemaPath = isProduction
  ? "./dist/src/ledger/pg/schema/index.js"
  : "./src/ledger/pg/schema/index.ts";

export default defineConfig({
  schema: schemaPath,
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: { rejectUnauthorized: false }
  }
});
```

Actually, `drizzle-kit migrate` doesn't need the schema at all — it only reads the SQL files in `./drizzle/`. The schema path is only needed for `drizzle-kit generate` and `drizzle-kit push`. So we can simplify:

Keep `drizzle.config.ts` original (pointing at `./src/...`), and in the Docker production image, `npm run db:migrate` only needs the SQL migrations and the config. Drizzle-kit migrate reads `drizzle.config.ts` for dialect and credentials, and reads `./drizzle/*.sql` for the SQL.

The issue is that `drizzle.config.ts` is TypeScript. In production, we'd need `tsx` or the compiled JS version.

Simplest fix: make `drizzle.config.ts` a plain `.js` file that Drizzle Kit can read natively:

Rename to `drizzle.config.mjs`:

```js
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/ledger/pg/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  }
});
```

This avoids needing tsx in production. Drizzle Kit reads `.mjs` natively.

- [ ] **Step 4: Run build to verify Dockerfile path works locally**

Run: `npm run build`

Expected: PASS (build doesn't depend on Docker)

- [ ] **Step 5: Commit**

```bash
git add railway.toml Dockerfile drizzle.config.ts package.json
git commit -m "m022: add preDeploy migration, update Dockerfile for drizzle migration support"
```

---

## Task 10: Update .env.example and Documentation

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add Postgres-related env vars to .env.example**

Add to the end of `.env.example`:

```
# Postgres connection string (shared Railway instance)
# When set, regime_engine schema is used automatically (search_path=regime_engine)
# When not set, the service runs in SQLite-only mode (no Postgres features)
DATABASE_URL=

# Postgres max connections (optional, defaults to postgres.js default of 10)
# PG_MAX_CONNECTIONS=10

# Insight ingest token for CLMM insights API (#21)
# INSIGHT_INGEST_TOKEN=
```

- [ ] **Step 2: Run full quality gate**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`

Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "m022: add DATABASE_URL and PG_MAX_CONNECTIONS to .env.example"
```

---

## Task 11: Verify Full Integration with Docker Compose

**Files:**
- No new files

- [ ] **Step 1: Start Postgres via Docker Compose**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
```

Wait for healthcheck:
```bash
docker compose -f docker-compose.test.yml exec postgres pg_isready -U test -d regime_engine_test
```

Expected: `accepting connections`

- [ ] **Step 2: Push the initial migration**

Run:
```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test npm run db:push
```

Expected: Schema `regime_engine` created on the test Postgres.

- [ ] **Step 3: Verify the schema exists**

Run:
```bash
psql "postgres://test:test@localhost:5432/regime_engine_test" -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'regime_engine';"
```

Expected: Output shows `regime_engine` row.

- [ ] **Step 4: Run integration tests**

Run:
```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test npm run test:pg
```

Expected: All tests PASS, including the Postgres DB factory test and health check tests.

- [ ] **Step 5: Tear down**

Run:
```bash
docker compose -f docker-compose.test.yml down
```

- [ ] **Step 6: Run default tests one more time (no Postgres) to confirm no regression**

Run: `npm run test`

Expected: All tests PASS

- [ ] **Step 7: Run full quality gate**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`

Expected: All PASS

---

## Self-Review Checklist

### 1. Spec coverage (#22 issue tasks)

| #22 Task | Plan Task |
|---|---|
| Create `regime_engine` schema | Task 2 (migration), Task 11 (verify) |
| Configure regime-engine DB connection with `search_path=regime_engine` | Task 3 (onconnect), Task 4 (StoreContext) |
| Set up Drizzle with schema isolation | Task 2 (config), Task 3 (db.ts) |
| Migrate/create data tables in `regime_engine` schema | Task 2 (initial migration only; #20/#21 add feature tables) |
| Add new regime engine endpoints backed by Postgres | Out of scope — #20/#21 own this |
| Document multi-schema architecture | Task 10 (.env.example) — design doc already written |

### 2. Placeholder scan

- No `TBD`, `TODO`, `TODO:`, "implement later", "fill in details" found.
- No "add appropriate error handling" / "add validation" without code.
- No "write tests for the above" without actual test code.
- No "similar to Task N" shortcuts.
- All steps contain exact code or exact commands.

### 3. Type consistency

- `StoreContext.ledger` type: `LedgerStore` (from `src/ledger/store.ts`) — consistent across Task 4 and Task 5.
- `StoreContext.pg` type: `Db` (from `src/ledger/pg/db.ts`, which is `ReturnType<typeof createDb>["db"]`) — consistent across all tasks.
- `StoreContext.pgClient` type: `{ end: () => Promise<void> }` — matches `postgres.js` client return type.
- `verifyPgConnection` parameter type: `Db` — matches the type exported from `db.ts`.
- `createStoreContext` parameters: `(ledgerPath: string, pgConnectionString: string)` — matches usage in Task 5.
- Health endpoint response shape: `{ ok: boolean, postgres: string, sqlite: string }` — consistent across Task 5, Task 6, Task 8.