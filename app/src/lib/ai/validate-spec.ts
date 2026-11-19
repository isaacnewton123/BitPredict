import {
  AutoApiOracleConfigSchema,
  isAutoApiConfig,
  MarketSpecSchema,
  NostrOracleConfigSchema,
  type MarketSpec,
} from "@/lib/domain/market-spec";
import { computeSpecSha256 } from "@/lib/domain/spec-hash";
import { checkTimeRules } from "@/lib/domain/time-rules";
import { validateAutoApiAgainstRegistry } from "@/lib/oracle/registry";

export type FullSpecValidationResult =
  | {
      ok: true;
      spec: MarketSpec;
      specSha256: string;
      auditUrl: string | null;
      warnings: string[];
    }
  | {
      ok: false;
      errors: string[];
    };

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readPathValue(root: unknown, pathParts: readonly PropertyKey[]): unknown {
  let curr: unknown = root;
  for (const seg of pathParts) {
    if (!isPlainRecord(curr) || typeof seg !== "string") return undefined;
    curr = curr[seg];
  }
  return curr;
}

function formatSchemaErrors(
  raw: unknown,
  issues: ReadonlyArray<{ code: string; path: PropertyKey[]; message: string }>,
): string[] {
  const errors: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 1 && issue.path[0] === "oracle_config" && issue.code === "invalid_union" && isPlainRecord(raw)) {
      const cfg = raw.oracle_config;
      const track = raw.resolution_track;
      const targetSchema =
        track === "auto_api" || (isPlainRecord(cfg) && "provider" in cfg)
          ? AutoApiOracleConfigSchema
          : track === "nostr_oracle"
            ? NostrOracleConfigSchema
            : null;
      if (targetSchema) {
        const sub = targetSchema.safeParse(cfg);
        if (!sub.success && sub.error.issues.length > 0) {
          for (const subIssue of sub.error.issues) {
            const subPath = ["oracle_config", ...subIssue.path.map(String)].join(".");
            const offending = readPathValue(cfg, subIssue.path);
            const detail =
              subIssue.code === "invalid_union" &&
              (Array.isArray(offending) || isPlainRecord(offending))
                ? "expected string, number, or boolean (not an array or object)"
                : subIssue.message;
            errors.push(`${subPath}: ${detail}`);
          }
          continue;
        }
      }
    }
    errors.push(`${issue.path.map(String).join(".") || "root"}: ${issue.message}`);
  }
  return errors;
}

export function validateFullMarketSpec(
  raw: unknown,
  opts: { now?: Date; minOpenMs?: number } = {},
): FullSpecValidationResult {
  const parsed = MarketSpecSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: formatSchemaErrors(raw, parsed.error.issues),
    };
  }

  const spec = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const v of checkTimeRules(spec, { now: opts.now, minOpenMs: opts.minOpenMs })) {
    errors.push(`${v.field}: ${v.message}`);
  }

  let auditUrl: string | null = null;
  if (isAutoApiConfig(spec.oracle_config)) {
    const reg = validateAutoApiAgainstRegistry(spec.oracle_config);
    if (!reg.ok) {
      errors.push(...reg.errors);
    } else {
      auditUrl = reg.auditUrl;
      const deadlineMs = Date.parse(spec.deadline_utc);
      const resolveMs = Date.parse(spec.resolve_after_utc);
      if (resolveMs - deadlineMs < reg.settleDelaySec * 1000) {
        warnings.push(
          `resolve_after_utc is sooner than recommended ${reg.settleDelaySec}s settle delay for ${spec.oracle_config.provider}.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    spec,
    specSha256: computeSpecSha256(spec),
    auditUrl,
    warnings,
  };
}
