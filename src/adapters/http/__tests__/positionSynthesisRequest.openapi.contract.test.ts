import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";

describe("positionSynthesisRequest openapi contract", () => {
  it("documents authentication request modes 202 400 401 500 and 503 responses", () => {
    const doc = buildOpenApiDocument();

    const securitySchemes = doc.components.securitySchemes as Record<string, unknown>;
    expect(securitySchemes.PolicySynthesisToken).toEqual({
      type: "apiKey",
      in: "header",
      name: "X-Policy-Synthesis-Token"
    });

    const paths = doc.paths as Record<
      string,
      { post?: { summary?: string; security?: unknown; responses?: Record<string, unknown> } }
    >;
    const path = paths["/v1/internal/insights/sol-usdc/synthesis-requests"];
    expect(path).toBeDefined();
    expect(path.post).toBeDefined();

    const post = path.post!;
    expect(post.summary).toBeDefined();
    expect(post.security).toEqual([{ PolicySynthesisToken: [] }]);

    const responses = post.responses;
    expect(responses).toBeDefined();
    expect(responses!["202"]).toBeDefined();
    expect(responses!["400"]).toBeDefined();
    expect(responses!["401"]).toBeDefined();
    expect(responses!["500"]).toBeDefined();
    expect(responses!["503"]).toBeDefined();
  });
});
