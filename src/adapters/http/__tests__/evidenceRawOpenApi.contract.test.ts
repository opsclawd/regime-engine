import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";

interface OpenApiParameter {
  name: string;
  in?: string;
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

describe("Raw observations OpenAPI contract", () => {
  const doc = buildOpenApiDocument();

  it("documents GET /v1/evidence/sol-usdc/{id}/raw as a public operation", () => {
    const pathItem = doc.paths["/v1/evidence/sol-usdc/{id}/raw"];
    expect(pathItem).toBeDefined();
    expect(pathItem?.get).toBeDefined();
    expect(pathItem?.get?.security).toEqual([]);
    expect((pathItem?.get as Record<string, unknown> | undefined)?.requestBody).toBeUndefined();
    expect((pathItem as Record<string, unknown>)?.post).toBeUndefined();
    expect((pathItem as Record<string, unknown>)?.put).toBeUndefined();
    expect((pathItem as Record<string, unknown>)?.delete).toBeUndefined();
  });

  it("documents the bundle-id-or-run-id path parameter", () => {
    const getOp = doc.paths["/v1/evidence/sol-usdc/{id}/raw"]?.get;
    const params = (getOp?.parameters ?? []) as unknown as OpenApiParameter[];
    const idParam = params.find((p) => p.name === "id");
    expect(idParam).toBeDefined();
    expect(idParam?.in).toBe("path");
    expect(idParam?.required).toBe(true);
    expect(idParam?.schema).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 256
    });
    expect(idParam?.description?.toLowerCase()).toContain("numeric dispatch");
  });

  it("documents the exact raw observations success envelope", () => {
    const rawObsSchema = doc.components?.schemas?.RawObservation;
    expect(rawObsSchema).toEqual({
      type: "object",
      additionalProperties: true
    });

    const respSchema = doc.components?.schemas?.RawObservationsResponse;
    expect(respSchema).toBeDefined();
    expect(respSchema?.type).toBe("object");
    expect(respSchema?.additionalProperties).toBe(false);
    expect(respSchema?.required).toEqual(["schemaVersion", "pair", "runId", "items"]);
    expect(respSchema?.properties?.schemaVersion).toEqual({ type: "string" });
    expect(respSchema?.properties?.pair).toEqual({ type: "string" });
    expect(respSchema?.properties?.runId).toEqual({ type: "string" });
    expect(respSchema?.properties?.items).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/RawObservation" }
    });

    const getOp = doc.paths["/v1/evidence/sol-usdc/{id}/raw"]?.get;
    const okResponse = getOp?.responses?.["200"];
    expect(okResponse?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/RawObservationsResponse"
    );
  });

  it("documents every implemented raw-observation status", () => {
    const getOp = doc.paths["/v1/evidence/sol-usdc/{id}/raw"]?.get;
    const responses = getOp?.responses;
    const statusCodes = Object.keys(responses ?? {}).sort();
    expect(statusCodes).toEqual(["200", "400", "404", "500", "503"]);

    expect(responses?.["400"]?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/EvidenceError"
    );
    expect(responses?.["404"]?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/EvidenceError"
    );
    expect(responses?.["500"]?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/EvidenceError"
    );
    expect(responses?.["503"]?.content?.["application/json"]?.schema?.$ref).toBe(
      "#/components/schemas/EvidenceError"
    );
  });

  it("keeps raw observations separate from evidence ingestion and policy insights", () => {
    const rawPath = doc.paths["/v1/evidence/sol-usdc/{id}/raw"];
    expect(rawPath).toBeDefined();
    expect(rawPath?.get).toBeDefined();
    expect((rawPath as Record<string, unknown>)?.post).toBeUndefined();

    const insightPath = (doc.paths as Record<string, unknown>)["/v1/insights/sol-usdc/{id}/raw"];
    expect(insightPath).toBeUndefined();
  });
});
