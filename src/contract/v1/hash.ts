import { createHash } from "node:crypto";
import { toCanonicalJson } from "./canonical.js";

export const sha256Hex = (input: string): string => {
  return createHash("sha256").update(input, "utf8").digest("hex");
};

export const planHashFromPlan = (plan: unknown): string => {
  return sha256Hex(toCanonicalJson(plan));
};
