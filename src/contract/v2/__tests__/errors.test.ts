import { describe, expect, it } from "vitest";
import {
  V2ContractValidationError,
  unsupportedSchemaVersionV2Error,
  validationErrorV2FromZod,
  serviceUnavailableV2Error,
  unauthorizedV2Error,
  serverMisconfigurationV2Error,
  srThesisV2NotFoundError,
  buildSrThesisV2ConflictEnvelope,
  internalErrorV2
} from "../errors.js";
import { z, ZodError } from "zod";

describe("v2 error envelopes", () => {
  it("UNSUPPORTED_SCHEMA_VERSION envelope uses schemaVersion 2.0", () => {
    const err = unsupportedSchemaVersionV2Error("1.5");
    expect(err.statusCode).toBe(400);
    expect(err.response.schemaVersion).toBe("2.0");
    expect(err.response.error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(err.response.error.details[0].path).toBe("$.schemaVersion");
  });

  it("VALIDATION_ERROR envelope translates Zod issues with v2 envelope", () => {
    const schema = z.object({ foo: z.string() });
    const result = schema.safeParse({});
    const issues = (result.error as ZodError).issues;
    const err = validationErrorV2FromZod("Invalid /v2/sr-levels request body", issues);
    expect(err.statusCode).toBe(400);
    expect(err.response.schemaVersion).toBe("2.0");
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
    expect(err.response.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.foo", code: "REQUIRED" })])
    );
  });

  it("503 envelope uses schemaVersion 2.0 and SERVICE_UNAVAILABLE", () => {
    const env = serviceUnavailableV2Error("Postgres-backed S/R thesis store unavailable");
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("401 envelope uses schemaVersion 2.0 and UNAUTHORIZED", () => {
    const env = unauthorizedV2Error();
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("UNAUTHORIZED");
  });

  it("500 SERVER_MISCONFIGURATION envelope uses schemaVersion 2.0", () => {
    const env = serverMisconfigurationV2Error("OPENCLAW_INGEST_TOKEN");
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SERVER_MISCONFIGURATION");
    expect(env.error.message).toContain("OPENCLAW_INGEST_TOKEN");
  });

  it("404 SR_THESIS_V2_NOT_FOUND envelope uses schemaVersion 2.0", () => {
    const env = srThesisV2NotFoundError("SOL", "macro-charts");
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SR_THESIS_V2_NOT_FOUND");
  });

  it("409 SR_THESIS_V2_CONFLICT envelope uses schemaVersion 2.0", () => {
    const env = buildSrThesisV2ConflictEnvelope({
      source: "macro-charts",
      symbol: "SOL",
      briefId: "b-1",
      asset: "SOL",
      sourceHandle: "@trader"
    });
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SR_THESIS_V2_CONFLICT");
  });

  it("INTERNAL_ERROR envelope uses schemaVersion 2.0", () => {
    const env = internalErrorV2();
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("INTERNAL_ERROR");
  });

  it("V2ContractValidationError carries statusCode and response", () => {
    const env = unsupportedSchemaVersionV2Error("1.0");
    expect(env).toBeInstanceOf(V2ContractValidationError);
  });
});
