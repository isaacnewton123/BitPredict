import { createHash } from "node:crypto";
import { canonicalizeJson } from "./canonical-json";
import type { MarketSpec } from "./market-spec";

export { canonicalizeJson };

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeSpecSha256(spec: MarketSpec): string {
  return sha256Hex(canonicalizeJson(spec));
}
