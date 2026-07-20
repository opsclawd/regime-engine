import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";

interface OpenApiParameter {
  name: string;
  in?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

describe("Evidence OpenAPI contract", () => {
  const doc = buildOpenApiDocument();

  describe("documents evidence without granting policy authority", () => {
    it("exposes three separate evidence paths", () => {
      expect(doc.paths["/v1/evidence/sol-usdc"]).toBeDefined();
      expect(doc.paths["/v1/evidence/sol-usdc/current"]).toBeDefined();
      expect(doc.paths["/v1/evidence/sol-usdc/history"]).toBeDefined();
    });

    it("POST /v1/evidence/sol-usdc requires EvidenceIngestToken apiKey security", () => {
      const postOp = doc.paths["/v1/evidence/sol-usdc"]?.post;
      expect(postOp).toBeDefined();
      expect(postOp?.security).toEqual([{ EvidenceIngestToken: [] }]);
    });

    it("GET /v1/evidence/sol-usdc/current has explicit empty security", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/current"]?.get;
      expect(getOp).toBeDefined();
      expect(getOp?.security).toEqual([]);
    });

    it("GET /v1/evidence/sol-usdc/history has explicit empty security", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/history"]?.get;
      expect(getOp).toBeDefined();
      expect(getOp?.security).toEqual([]);
    });

    it("POST /v1/evidence/sol-usdc requestBody uses $ref to EvidenceBundleV1 schema", () => {
      const postOp = doc.paths["/v1/evidence/sol-usdc"]?.post;
      expect(postOp?.requestBody?.content?.["application/json"]?.schema?.$ref).toBe(
        "#/components/schemas/EvidenceBundleV1"
      );
    });

    it("POST /v1/evidence/sol-usdc has complete status codes", () => {
      const postOp = doc.paths["/v1/evidence/sol-usdc"]?.post;
      const responses = postOp?.responses;
      expect(responses).toEqual(
        expect.objectContaining({
          "200": expect.any(Object),
          "201": expect.any(Object),
          "400": expect.any(Object),
          "401": expect.any(Object),
          "409": expect.any(Object),
          "413": expect.any(Object),
          "500": expect.any(Object),
          "503": expect.any(Object)
        })
      );
    });

    it("GET /v1/evidence/sol-usdc/current has complete status codes", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/current"]?.get;
      const responses = getOp?.responses;
      expect(responses).toEqual(
        expect.objectContaining({
          "200": expect.any(Object),
          "400": expect.any(Object),
          "404": expect.any(Object),
          "500": expect.any(Object),
          "503": expect.any(Object)
        })
      );
    });

    it("GET /v1/evidence/sol-usdc/history has complete status codes", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/history"]?.get;
      const responses = getOp?.responses;
      expect(responses).toEqual(
        expect.objectContaining({
          "200": expect.any(Object),
          "400": expect.any(Object),
          "500": expect.any(Object),
          "503": expect.any(Object)
        })
      );
    });

    it("GET /v1/evidence/sol-usdc/current has all strict query parameters", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/current"]?.get;
      const params = (getOp?.parameters ?? []) as unknown as OpenApiParameter[];
      const paramNames = params.map((p) => p.name);
      expect(paramNames).toContain("scope");
      expect(paramNames).toContain("whirlpoolAddress");
      expect(paramNames).toContain("walletAddress");
      expect(paramNames).toContain("positionId");
      expect(paramNames).toContain("source.publisher");
      expect(paramNames).toContain("source.sourceId");
    });

    it("GET /v1/evidence/sol-usdc/history has cursor and limit query parameters", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/history"]?.get;
      const params = (getOp?.parameters ?? []) as unknown as OpenApiParameter[];
      const paramNames = params.map((p) => p.name);
      expect(paramNames).toContain("cursor");
      expect(paramNames).toContain("limit");
    });

    it("history limit has default 30 and max 100", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/history"]?.get;
      const params = (getOp?.parameters ?? []) as unknown as OpenApiParameter[];
      const limitParam = params.find((p) => p.name === "limit");
      const schema = limitParam?.schema as { default?: number; maximum?: number } | undefined;
      expect(schema?.default).toBe(30);
      expect(schema?.maximum).toBe(100);
    });

    it("current response uses $ref to EvidenceCurrentResponse schema", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/current"]?.get;
      const responseSchema = getOp?.responses?.["200"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/EvidenceCurrentResponse");
    });

    it("history response uses $ref to EvidenceHistoryResponse schema", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/history"]?.get;
      const responseSchema = getOp?.responses?.["200"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/EvidenceHistoryResponse");
    });

    it("has EvidenceBundleV1 schema in components", () => {
      expect(doc.components?.schemas?.EvidenceBundleV1).toBeDefined();
    });

    it("has EvidenceRecord, EvidenceFreshness, EvidenceReceipt schemas in components", () => {
      expect(doc.components?.schemas?.EvidenceRecord).toBeDefined();
      expect(doc.components?.schemas?.EvidenceFreshness).toBeDefined();
      expect(doc.components?.schemas?.EvidenceReceipt).toBeDefined();
    });

    it("has EvidenceCurrentResponse, EvidenceHistoryResponse schemas in components", () => {
      expect(doc.components?.schemas?.EvidenceCurrentResponse).toBeDefined();
      expect(doc.components?.schemas?.EvidenceHistoryResponse).toBeDefined();
    });

    it("has EvidenceError and EvidenceCursor schemas in components", () => {
      expect(doc.components?.schemas?.EvidenceError).toBeDefined();
      expect(doc.components?.schemas?.EvidenceCursor).toBeDefined();
    });

    it("has EvidenceIngestToken security scheme in components", () => {
      const scheme = doc.components?.securitySchemes?.EvidenceIngestToken;
      expect(scheme).toEqual({
        type: "apiKey",
        in: "header",
        name: "X-Evidence-Ingest-Token"
      });
    });

    it("documents fixed SOL/USDC pair", () => {
      const evidenceBundleSchema = doc.components?.schemas?.EvidenceBundleV1;
      expect(evidenceBundleSchema?.$defs?.pair?.const).toBe("SOL/USDC");
    });

    it("documents fixed solana-mainnet for non-pair scopes", () => {
      const scopeSchema = doc.components?.schemas?.EvidenceBundleV1?.properties?.scope;
      expect(scopeSchema).toBeDefined();
    });

    it("documents identifier bounds (1-128 characters)", () => {
      const evidenceBundleSchema = doc.components?.schemas?.EvidenceBundleV1;
      expect(evidenceBundleSchema).toBeDefined();
    });

    it("documents pair as default scope", () => {
      const evidenceBundleSchema = doc.components?.schemas?.EvidenceBundleV1;
      expect(evidenceBundleSchema).toBeDefined();
    });

    it("descriptions state no-selection for current endpoint", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/current"]?.get;
      expect(getOp?.summary?.toLowerCase()).toContain("no selection");
    });

    it("documents opaque cursor continuation", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/history"]?.get;
      const params = (getOp?.parameters ?? []) as unknown as OpenApiParameter[];
      const cursorParam = params.find((p) => p.name === "cursor");
      expect(cursorParam?.description?.toLowerCase()).toContain("cursor");
    });

    it("keeps evidence writes separate from canonical insight reads", () => {
      expect(doc.paths["/v1/evidence/sol-usdc"]?.post).toBeDefined();
      expect((doc.paths as Record<string, unknown>)["/v1/insights/sol-usdc"]).toBeUndefined();
      expect(doc.paths["/v1/insights/sol-usdc/current"]).toBeDefined();
      expect(doc.paths["/v1/insights/sol-usdc/history"]).toBeDefined();
    });

    it("POST /v1/evidence/sol-usdc response examples use handler field names", () => {
      const postOp = doc.paths["/v1/evidence/sol-usdc"]?.post;
      const createdResponse = postOp?.responses?.["201"];
      const example = createdResponse?.content?.["application/json"]?.example;
      expect(example).toBeDefined();
      expect(example).toHaveProperty("receiptId");
      expect(example).toHaveProperty("receivedAt");
    });

    it("GET /v1/evidence/sol-usdc/current response examples use handler field names", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/current"]?.get;
      const okResponse = getOp?.responses?.["200"];
      const example = okResponse?.content?.["application/json"]?.example;
      expect(example).toBeDefined();
      expect(example).toHaveProperty("schemaVersion");
      expect(example).toHaveProperty("pair");
      expect(example).toHaveProperty("scope");
      expect(example).toHaveProperty("queriedAt");
      expect(example).toHaveProperty("items");
      expect(example).not.toHaveProperty("nextCursor");
    });

    it("GET /v1/evidence/sol-usdc/history response examples use handler field names", () => {
      const getOp = doc.paths["/v1/evidence/sol-usdc/history"]?.get;
      const okResponse = getOp?.responses?.["200"];
      const example = okResponse?.content?.["application/json"]?.example;
      expect(example).toBeDefined();
      expect(example).toHaveProperty("items");
      expect(example).toHaveProperty("nextCursor");
    });
  });
});
