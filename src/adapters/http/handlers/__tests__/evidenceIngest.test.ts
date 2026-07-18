import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createEvidenceIngestHandler } from "../evidenceIngest.js";
import type { IngestEvidenceBundleUseCase } from "../../../../application/use-cases/ingestEvidenceBundleUseCase.js";
import { EvidenceBundleValidationError } from "../../../../contract/evidence/v1/validate.js";
import { EvidenceRunConflictError } from "../../../../application/ports/evidenceBundleRepositoryPort.js";
import { EvidenceStoreUnavailableError } from "../../../../application/errors/evidenceErrors.js";

const DETERMINISTIC_ONLY_FIXTURE = {
  schemaVersion: "evidence-bundle.v1",
  pair: "SOL/USDC",
  scope: { kind: "pair" },
  source: {
    publisher: "sol-usdc-clmm-intelligence",
    sourceId: "src-deterministic-only-001",
    sourceVersion: "1.0.0"
  },
  runId: "run-deterministic-only-001",
  correlationId: "corr-deterministic-only-001",
  createdAt: "2024-01-15T10:00:00.000Z",
  asOf: "2024-01-15T10:00:00.000Z",
  freshUntil: "2024-01-15T11:00:00.000Z",
  expiresAt: "2024-01-15T12:00:00.000Z",
  deterministicFeatures: [
    {
      featureId: "feat-price-001",
      family: "market_state",
      featureKind: "number",
      status: "available",
      value: 150.25,
      unit: "usd",
      observedAt: "2024-01-15T10:00:00.000Z",
      freshUntil: "2024-01-15T11:00:00.000Z",
      confidenceBps: 9500,
      calculator: { name: "price-aggregator", version: "1.0.0" },
      inputLineage: ["ref-price-source"],
      warnings: []
    }
  ],
  contextualEvidence: {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events: [],
    newsRegulatory: []
  },
  researchBrief: null,
  sourceReferences: [
    {
      referenceId: "ref-price-source",
      sourceType: "api",
      locator: "https://api.example.com/price",
      observedAt: "2024-01-15T09:59:00.000Z"
    }
  ],
  assessment: {
    overallConfidenceBps: 9500,
    quality: "degraded",
    coverage: {
      deterministic: "available",
      supportResistance: "unavailable",
      flows: "unavailable",
      derivatives: "unavailable",
      events: "unavailable",
      newsRegulatory: "unavailable",
      researchBrief: "unavailable"
    },
    warnings: [
      {
        code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
        message: "All contextual evidence families are unavailable",
        affectedFamilies: ["supportResistance", "flows", "derivatives", "events", "newsRegulatory"]
      },
      {
        code: "RESEARCH_BRIEF_UNAVAILABLE",
        message: "Research brief is null",
        affectedFamilies: ["researchBrief"]
      }
    ]
  },
  provenance: {
    pipelineVersion: "1.0.0",
    gitCommit: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
    environment: "test",
    upstreamRunIds: []
  }
};

const VALID_SECRET = "test-secret-token";
const AUTH_HEADER = "x-evidence-ingest-token";

describe("createEvidenceIngestHandler", () => {
  describe("authentication", () => {
    it("returns 401 when token is missing", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(null));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: { "content-type": "application/json" },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.details).toEqual([]);
      vi.unstubAllEnvs();
    });

    it("returns 401 when token is wrong", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(null));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: "wrong-token"
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.details).toEqual([]);
      vi.unstubAllEnvs();
    });

    it("returns 500 when server token is unset", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", "");
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(null));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("SERVER_MISCONFIGURATION");
      vi.unstubAllEnvs();
    });

    it("authenticates before validation and persistence", async () => {
      const useCaseCalls: unknown[] = [];
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const fakeUseCase: IngestEvidenceBundleUseCase = async (input) => {
        useCaseCalls.push(input);
        return {
          status: "created" as const,
          runId: "run-test",
          evidenceHash: "abc123",
          receipt: { id: 1, evidenceHash: "abc123", receivedAtUnixMs: Date.now(), scopeKey: "pair" }
        };
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(fakeUseCase));
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: "wrong-token"
        },
        payload: { invalid: "body" }
      });

      expect(useCaseCalls).toHaveLength(0);
      vi.unstubAllEnvs();
    });
  });

  describe("null use case", () => {
    it("returns 503 when use case is null", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(null));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      expect(body.error.details).toEqual([]);
      vi.unstubAllEnvs();
    });

    it("does not call use case when null", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(null));
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(503);
      vi.unstubAllEnvs();
    });
  });

  describe("validation error handling", () => {
    it("returns 400 with sorted issues on validation error", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const validationError = new EvidenceBundleValidationError([
        { path: "runId", code: "STRUCTURAL", message: "runId is required" },
        { path: "pair", code: "SEMANTIC", message: "pair format invalid" }
      ]);
      const failingUseCase: IngestEvidenceBundleUseCase = async () => {
        throw validationError;
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(failingUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: { schemaVersion: "evidence-bundle.v1" }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details).toHaveLength(2);
      expect(body.error.details[0].path).toBe("pair");
      expect(body.error.details[1].path).toBe("runId");
      vi.unstubAllEnvs();
    });

    it("preserves validation issues without mutation", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const issues = [
        { path: "z-field", code: "STRUCTURAL" as const, message: "z message" },
        { path: "a-field", code: "SEMANTIC" as const, message: "a message" }
      ];
      const failingUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new EvidenceBundleValidationError(issues);
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(failingUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: { schemaVersion: "evidence-bundle.v1" }
      });

      const body = JSON.parse(response.body);
      expect(body.error.details[0].path).toBe("a-field");
      expect(body.error.details[1].path).toBe("z-field");
      vi.unstubAllEnvs();
    });
  });

  describe("conflict error handling", () => {
    it("returns 409 on EvidenceRunConflictError", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const conflictUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new EvidenceRunConflictError(
          "Run ID already exists",
          "existing-hash",
          "incoming-hash"
        );
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(conflictUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("EVIDENCE_RUN_CONFLICT");
      expect(body.error.details).toEqual([]);
      vi.unstubAllEnvs();
    });

    it("redacts conflict error details", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const conflictUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new EvidenceRunConflictError(
          "Run ID already exists",
          "existing-hash",
          "incoming-hash"
        );
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(conflictUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      const body = JSON.parse(response.body);
      expect(body.error.message).not.toContain("existing-hash");
      expect(body.error.message).not.toContain("incoming-hash");
      expect(body.error.message).not.toContain("Run ID already exists");
      vi.unstubAllEnvs();
    });
  });

  describe("store unavailable handling", () => {
    it("returns 503 on EvidenceStoreUnavailableError", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const unavailableUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new EvidenceStoreUnavailableError("Connection refused");
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(unavailableUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      expect(body.error.details).toEqual([]);
      vi.unstubAllEnvs();
    });

    it("redacts store unavailable error details", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const unavailableUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new EvidenceStoreUnavailableError("Connection refused to postgres://...");
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(unavailableUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      const body = JSON.parse(response.body);
      expect(body.error.message).not.toContain("postgres");
      expect(body.error.message).not.toContain("Connection refused");
      vi.unstubAllEnvs();
    });
  });

  describe("unknown error handling", () => {
    it("returns 500 on unknown errors", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const errorUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new Error("Something went wrong");
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(errorUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      vi.unstubAllEnvs();
    });

    it("redacts unknown error details", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const errorUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new Error("Sensitive error details");
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(errorUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      const body = JSON.parse(response.body);
      expect(body.error.message).not.toContain("Sensitive error details");
      vi.unstubAllEnvs();
    });
  });

  describe("successful ingestion", () => {
    it("returns 201 on created status", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const CLOCK_TIME = 1_700_000_000_000;
      const createdUseCase: IngestEvidenceBundleUseCase = async () => ({
        status: "created" as const,
        runId: "run-deterministic-only-001",
        evidenceHash: "abc123def456",
        receipt: {
          id: 42,
          evidenceHash: "abc123def456",
          receivedAtUnixMs: CLOCK_TIME,
          scopeKey: "pair"
        }
      });
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(createdUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.schemaVersion).toBe("evidence-bundle.v1");
      expect(body.status).toBe("created");
      expect(body.runId).toBe("run-deterministic-only-001");
      expect(body.evidenceHash).toBe("abc123def456");
      expect(body.receiptId).toBe(42);
      expect(body.receivedAt).toBe("2023-11-14T22:13:20.000Z");
      vi.unstubAllEnvs();
    });

    it("returns 200 on already_ingested status", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const CLOCK_TIME = 1_700_000_000_000;
      const ingestedUseCase: IngestEvidenceBundleUseCase = async () => ({
        status: "already_ingested" as const,
        runId: "run-deterministic-only-001",
        evidenceHash: "abc123def456",
        receipt: {
          id: 42,
          evidenceHash: "abc123def456",
          receivedAtUnixMs: CLOCK_TIME,
          scopeKey: "pair"
        }
      });
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(ingestedUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("already_ingested");
      expect(body.receivedAt).toBe("2023-11-14T22:13:20.000Z");
      vi.unstubAllEnvs();
    });

    it("maps ingest replay state without replacing receipts", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const existingReceipt = {
        id: 99,
        evidenceHash: "abc123def456",
        receivedAtUnixMs: 1_700_000_000_000,
        scopeKey: "pair"
      };
      const replayUseCase: IngestEvidenceBundleUseCase = async () => ({
        status: "already_ingested" as const,
        runId: "run-deterministic-only-001",
        evidenceHash: "abc123def456",
        receipt: existingReceipt
      });
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(replayUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.receiptId).toBe(99);
      expect(body.receivedAt).toBe("2023-11-14T22:13:20.000Z");
      vi.unstubAllEnvs();
    });

    it("calls use case with the request body", async () => {
      const useCaseCalls: unknown[] = [];
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const trackingUseCase: IngestEvidenceBundleUseCase = async (input) => {
        useCaseCalls.push(input);
        return {
          status: "created" as const,
          runId: "run-deterministic-only-001",
          evidenceHash: "abc123def456",
          receipt: {
            id: 42,
            evidenceHash: "abc123def456",
            receivedAtUnixMs: 1_700_000_000_000,
            scopeKey: "pair"
          }
        };
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(trackingUseCase));
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      expect(useCaseCalls).toHaveLength(1);
      expect(useCaseCalls[0]).toEqual(DETERMINISTIC_ONLY_FIXTURE);
      vi.unstubAllEnvs();
    });
  });

  describe("token and body redaction in logs", () => {
    it("does not expose token in response body", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const successUseCase: IngestEvidenceBundleUseCase = async () => ({
        status: "created" as const,
        runId: "run-test",
        evidenceHash: "abc123",
        receipt: { id: 1, evidenceHash: "abc123", receivedAtUnixMs: Date.now(), scopeKey: "pair" }
      });
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(successUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: DETERMINISTIC_ONLY_FIXTURE
      });

      const body = response.body;
      expect(body).not.toContain(VALID_SECRET);
      vi.unstubAllEnvs();
    });

    it("does not expose full body in error responses", async () => {
      vi.stubEnv("EVIDENCE_INGEST_TOKEN", VALID_SECRET);
      const errorUseCase: IngestEvidenceBundleUseCase = async () => {
        throw new Error("Secret data in error");
      };
      const app = Fastify();
      app.post("/ingest", createEvidenceIngestHandler(errorUseCase));
      await app.ready();

      const response = await app.inject({
        method: "POST",
        url: "/ingest",
        headers: {
          "content-type": "application/json",
          [AUTH_HEADER]: VALID_SECRET
        },
        payload: { apiKey: "super-secret-key", data: "sensitive-payload" }
      });

      const body = JSON.parse(response.body);
      expect(JSON.stringify(body)).not.toContain("super-secret-key");
      expect(JSON.stringify(body)).not.toContain("sensitive-payload");
      vi.unstubAllEnvs();
    });
  });
});
