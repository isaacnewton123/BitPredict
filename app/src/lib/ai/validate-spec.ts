import { isAutoApiConfig, MarketSpecSchema, type MarketSpec } from "@/lib/domain/market-spec";
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

export function validateFullMarketSpec(
  raw: unknown,
  opts: { now?: Date; minOpenMs?: number } = {},
): FullSpecValidationResult {
  const parsed = MarketSpecSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "root"}: ${i.message}`,
    );
    return { ok: false, errors };
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
