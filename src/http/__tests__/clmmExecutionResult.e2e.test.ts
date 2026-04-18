import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../ledger/store.js";

const createdDbPaths: string[] = [];

const makeClmmEventPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  correlationId: "corr-001",
  positionId: "pos-001",
  breachDirection: "LowerBoundBreach",
  reconciledAtIso: "2025-04-17T12:00:00Z",
  txSignature: "sig-abc123",
  tokenOut: "USDC",
  status: "confirmed",
  ...overrides
});

afterEach(() => {
  for (const path of createdDbPaths.splice(0, createdDbPaths.length)) {
    rmSync(path, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CLMM_INTERNAL_TOKEN;
});

describe("/v1/clmm-execution-result e2e", () => {
  it("valid POST returns 200 and persists row", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-clmm-e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;
    process.env.CLMM_INTERNAL_TOKEN = "test-clmm-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "test-clmm-token" },
      payload: makeClmmEventPayload()
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; correlationId: string; idempotent?: boolean };
    expect(body).toEqual({
      ok: true,
      correlationId: "corr-001"
    });

    await app.close();

    const verifyStore = createLedgerStore(dbPath);
    expect(getLedgerCounts(verifyStore).clmmExecutionEvents).toBe(1);
    verifyStore.close();
  });

  it("idempotent replay with byte-equal payload returns 200 with idempotent: true and no new row", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.CLMM_INTERNAL_TOKEN = "test-clmm-token";

    const app = buildApp();
    const payload = makeClmmEventPayload();

    const first = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "test-clmm-token" },
      payload
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      ok: true,
      correlationId: "corr-001"
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "test-clmm-token" },
      payload
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({
      ok: true,
      correlationId: "corr-001",
      idempotent: true
    });

    await app.close();
  });

  it("conflict: same correlationId with different payload returns 409", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.CLMM_INTERNAL_TOKEN = "test-clmm-token";

    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "test-clmm-token" },
      payload: makeClmmEventPayload()
    });

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "test-clmm-token" },
      payload: makeClmmEventPayload({ status: "failed" })
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      schemaVersion: "1.0",
      error: {
        code: "CLMM_EXECUTION_EVENT_CONFLICT",
        message: "CLMM execution event conflict for correlationId \"corr-001\".",
        details: []
      }
    });

    await app.close();
  });

  it("missing X-CLMM-Internal-Token returns 401 without writing", async () => {
    const dbPath = join(
      tmpdir(),
      `regime-engine-clmm-auth1-${Date.now()}-${Math.floor(Math.random() * 10_000)}.sqlite`
    );
    createdDbPaths.push(dbPath);
    process.env.LEDGER_DB_PATH = dbPath;
    process.env.CLMM_INTERNAL_TOKEN = "test-clmm-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      payload: makeClmmEventPayload()
    });
    expect(response.statusCode).toBe(401);

    await app.close();

    const verifyStore = createLedgerStore(dbPath);
    expect(getLedgerCounts(verifyStore).clmmExecutionEvents).toBe(0);
    verifyStore.close();
  });

  it("wrong X-CLMM-Internal-Token returns 401", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.CLMM_INTERNAL_TOKEN = "test-clmm-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "wrong-token" },
      payload: makeClmmEventPayload()
    });
    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it("missing CLMM_INTERNAL_TOKEN env var returns 500", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.CLMM_INTERNAL_TOKEN;

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "any-token" },
      payload: makeClmmEventPayload()
    });
    expect(response.statusCode).toBe(500);

    await app.close();
  });

  it("malformed payload returns 400", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.CLMM_INTERNAL_TOKEN = "test-clmm-token";

    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/clmm-execution-result",
      headers: { "X-CLMM-Internal-Token": "test-clmm-token" },
      payload: { garbage: true }
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });
});