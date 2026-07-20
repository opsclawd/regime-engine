import { createHash } from "node:crypto";
import { toCanonicalJson } from "../../v1/canonical.js";
import type { PolicyInsightContent } from "./types.generated.js";

export function computePolicyInsightContentCanonicalAndHash(content: PolicyInsightContent): {
  canonical: string;
  hash: string;
} {
  const canonical = toCanonicalJson(content);
  return { canonical, hash: sha256Hex(canonical) };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
