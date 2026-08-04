import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createEvidenceRawHandler } from "../evidenceRaw.js";
import type { GetRawObservationsForBundleUseCase } from "../../../../application/use-cases/getRawObservationsForBundleUseCase.js";
import {
  RawObservationIdentifierValidationError,
  EvidenceBundleNotFoundError,
  RawObservationsNotFoundError,
  EvidenceStoreUnavailableError
} from "../../../../application/errors/evidenceErrors.js";
import { EVIDENCE_SCHEMA_VERSION } from "../../evidenceHttp.js";

const createTestApp = (useCase: GetRawObservationsForBundleUseCase | null) => {
  const app = Fastify();
  app.get("/:id/raw", createEvidenceRawHandler(useCase));
  return app;
};

describe("createEvidenceRawHandler", () => {
  it("returns 200 with the resolved run id and deterministic raw items", async () => {
    const mockUseCase = vi.fn().mockResolvedValue({
      runId: "resolved-run-123",
      items: [
        { obsId: "1", value: 100 },
        { obsId: "2", value: 200 }
      ]
    }) as unknown as GetRawObservationsForBundleUseCase;

    const app = createTestApp(mockUseCase);
    const response = await app.inject({
      method: "GET",
      url: "/bundle-123/raw"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      pair: "SOL/USDC",
      runId: "resolved-run-123",
      items: [
        { obsId: "1", value: 100 },
        { obsId: "2", value: 200 }
      ]
    });
    expect(mockUseCase).toHaveBeenCalledWith({ identifier: "bundle-123" });
    await app.close();
  });

  it("returns 400 VALIDATION_ERROR for an invalid identifier", async () => {
    const mockUseCase = vi
      .fn()
      .mockRejectedValue(
        new RawObservationIdentifierValidationError("Invalid numeric bundle identifier: -5")
      ) as unknown as GetRawObservationsForBundleUseCase;

    const app = createTestApp(mockUseCase);
    const response = await app.inject({
      method: "GET",
      url: "/-5/raw"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid numeric bundle identifier: -5",
        details: []
      }
    });
    await app.close();
  });

  it("returns 404 EVIDENCE_BUNDLE_NOT_FOUND for an unknown numeric bundle id", async () => {
    const mockUseCase = vi
      .fn()
      .mockRejectedValue(
        new EvidenceBundleNotFoundError(999)
      ) as unknown as GetRawObservationsForBundleUseCase;

    const app = createTestApp(mockUseCase);
    const response = await app.inject({
      method: "GET",
      url: "/999/raw"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      error: {
        code: "EVIDENCE_BUNDLE_NOT_FOUND",
        message: "Evidence bundle not found: 999",
        details: []
      }
    });
    await app.close();
  });

  it("returns 404 RAW_OBSERVATIONS_NOT_FOUND when the run exists but has no raw rows", async () => {
    const mockUseCase = vi
      .fn()
      .mockRejectedValue(
        new RawObservationsNotFoundError("empty-run-456")
      ) as unknown as GetRawObservationsForBundleUseCase;

    const app = createTestApp(mockUseCase);
    const response = await app.inject({
      method: "GET",
      url: "/empty-run-456/raw"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      error: {
        code: "RAW_OBSERVATIONS_NOT_FOUND",
        message: "Raw observations not found for run ID: empty-run-456",
        details: []
      }
    });
    await app.close();
  });

  it("returns 503 EVIDENCE_STORE_UNAVAILABLE when PostgreSQL is not configured", async () => {
    const app = createTestApp(null);
    const response = await app.inject({
      method: "GET",
      url: "/any-id/raw"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      error: {
        code: "EVIDENCE_STORE_UNAVAILABLE",
        message: "Evidence store is not available (no DATABASE_URL configured)",
        details: []
      }
    });
    await app.close();
  });

  it("returns 503 EVIDENCE_STORE_UNAVAILABLE for cross-schema read failures", async () => {
    const mockUseCase = vi
      .fn()
      .mockRejectedValue(
        new EvidenceStoreUnavailableError("DB connection failed", {
          cause: new Error("connection timeout")
        })
      ) as unknown as GetRawObservationsForBundleUseCase;

    const app = createTestApp(mockUseCase);
    const response = await app.inject({
      method: "GET",
      url: "/run-789/raw"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      error: {
        code: "EVIDENCE_STORE_UNAVAILABLE",
        message: "Evidence store is temporarily unavailable",
        details: []
      }
    });
    await app.close();
  });

  it("returns 500 INTERNAL_ERROR for unexpected failures", async () => {
    const mockUseCase = vi
      .fn()
      .mockRejectedValue(
        new Error("Unexpected crash")
      ) as unknown as GetRawObservationsForBundleUseCase;

    const app = createTestApp(mockUseCase);
    const response = await app.inject({
      method: "GET",
      url: "/run-xyz/raw"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred",
        details: []
      }
    });
    await app.close();
  });
});
