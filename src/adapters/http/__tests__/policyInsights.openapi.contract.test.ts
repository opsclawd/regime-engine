import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";
import currentPairInsight from "../../../../contracts/policy-insight/v1/fixtures/valid/current-pair.json" with { type: "json" };
import historyInsight from "../../../../contracts/policy-insight/v1/fixtures/valid/history.json" with { type: "json" };

describe("PolicyInsights OpenAPI contract", () => {
  const doc = buildOpenApiDocument();

  describe("documents policy insights endpoints", () => {
    it("omits the removed root insight path and retains both read paths", () => {
      expect(doc.paths["/v1/insights/sol-usdc"]).toBeUndefined();
      expect(doc.paths["/v1/insights/sol-usdc/current"]).toBeDefined();
      expect(doc.paths["/v1/insights/sol-usdc/history"]).toBeDefined();
    });

    it("GET /v1/insights/sol-usdc/current has correct status codes", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      expect(getOp).toBeDefined();
      const responses = getOp?.responses;
      expect(responses).toEqual(
        expect.objectContaining({
          "200": expect.any(Object),
          "400": expect.any(Object),
          "404": expect.any(Object),
          "503": expect.any(Object)
        })
      );
    });

    it("GET /v1/insights/sol-usdc/history has correct status codes", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/history"]?.get;
      expect(getOp).toBeDefined();
      const responses = getOp?.responses;
      expect(responses).toEqual(
        expect.objectContaining({
          "200": expect.any(Object),
          "400": expect.any(Object),
          "503": expect.any(Object)
        })
      );
    });

    it("has InsightError schema in components", () => {
      expect(doc.components?.schemas?.InsightError).toBeDefined();
    });

    it("has InsightCurrentResponse schema in components", () => {
      expect(doc.components?.schemas?.InsightCurrentResponse).toBeDefined();
    });

    it("has InsightHistoryResponse schema in components", () => {
      expect(doc.components?.schemas?.InsightHistoryResponse).toBeDefined();
    });

    it("GET /v1/insights/sol-usdc/current 200 response uses $ref to InsightCurrentResponse schema", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const responseSchema = getOp?.responses?.["200"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/InsightCurrentResponse");
    });

    it("GET /v1/insights/sol-usdc/history 200 response uses $ref to InsightHistoryResponse schema", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/history"]?.get;
      const responseSchema = getOp?.responses?.["200"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/InsightHistoryResponse");
    });

    it("GET /v1/insights/sol-usdc/current 400 response uses $ref to InsightError schema", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const responseSchema = getOp?.responses?.["400"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/InsightError");
    });

    it("GET /v1/insights/sol-usdc/current 404 response uses $ref to InsightError schema", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const responseSchema = getOp?.responses?.["404"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/InsightError");
    });

    it("GET /v1/insights/sol-usdc/current 503 response uses $ref to InsightError schema", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const responseSchema = getOp?.responses?.["503"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/InsightError");
    });

    it("GET /v1/insights/sol-usdc/history 400 response uses $ref to InsightError schema", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/history"]?.get;
      const responseSchema = getOp?.responses?.["400"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/InsightError");
    });

    it("GET /v1/insights/sol-usdc/history 503 response uses $ref to InsightError schema", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/history"]?.get;
      const responseSchema = getOp?.responses?.["503"]?.content?.["application/json"]?.schema;
      expect(responseSchema?.$ref).toBe("#/components/schemas/InsightError");
    });

    it("GET /v1/insights/sol-usdc/current has scope query parameter", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const params = getOp?.parameters ?? [];
      const paramNames = params.map((p: { name?: string }) => p.name);
      expect(paramNames).toContain("scope");
    });

    it("GET /v1/insights/sol-usdc/history has scope, limit, and cursor query parameters", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/history"]?.get;
      const params = getOp?.parameters ?? [];
      const paramNames = params.map((p: { name?: string }) => p.name);
      expect(paramNames).toContain("scope");
      expect(paramNames).toContain("limit");
      expect(paramNames).toContain("cursor");
    });

    it("GET /v1/insights/sol-usdc/current has whirlpoolAddress, walletAddress, positionId query parameters", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const params = getOp?.parameters ?? [];
      const paramNames = params.map((p: { name?: string }) => p.name);
      expect(paramNames).toContain("whirlpoolAddress");
      expect(paramNames).toContain("walletAddress");
      expect(paramNames).toContain("positionId");
    });

    it("has PolicyInsightSchema in components", () => {
      expect(doc.components?.schemas?.PolicyInsightSchema).toBeDefined();
    });

    it("GET /v1/insights/sol-usdc/current 200 response has published example attached", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const okResponse = getOp?.responses?.["200"];
      const examples = okResponse?.content?.["application/json"]?.examples;
      expect(examples).toBeDefined();
      const exampleValues = Object.values(examples as Record<string, { value?: unknown }>);
      const hasCurrentPairExample = exampleValues.some(
        (e) =>
          e.value &&
          (e.value as typeof currentPairInsight).insightId === currentPairInsight.insightId
      );
      expect(hasCurrentPairExample).toBe(true);
    });

    it("GET /v1/insights/sol-usdc/history 200 response has published example attached", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/history"]?.get;
      const okResponse = getOp?.responses?.["200"];
      const examples = okResponse?.content?.["application/json"]?.examples;
      expect(examples).toBeDefined();
      const exampleValues = Object.values(examples as Record<string, { value?: unknown }>);
      const hasHistoryExample = exampleValues.some(
        (e) => e.value && (e.value as typeof historyInsight).pair === historyInsight.pair
      );
      expect(hasHistoryExample).toBe(true);
    });

    it("current response example matches the published current-pair.json fixture", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/current"]?.get;
      const okResponse = getOp?.responses?.["200"];
      const examples = okResponse?.content?.["application/json"]?.examples;
      const exampleValues = Object.values(examples as Record<string, { value?: unknown }>);
      const currentExample = exampleValues.find(
        (e) =>
          e.value &&
          (e.value as typeof currentPairInsight).insightId === currentPairInsight.insightId
      );
      expect(currentExample?.value).toEqual(currentPairInsight);
    });

    it("history response example matches the published history.json fixture", () => {
      const getOp = doc.paths["/v1/insights/sol-usdc/history"]?.get;
      const okResponse = getOp?.responses?.["200"];
      const examples = okResponse?.content?.["application/json"]?.examples;
      const exampleValues = Object.values(examples as Record<string, { value?: unknown }>);
      const historyExample = exampleValues.find(
        (e) => e.value && (e.value as typeof historyInsight).pair === historyInsight.pair
      );
      expect(historyExample?.value).toEqual(historyInsight);
    });
  });
});
