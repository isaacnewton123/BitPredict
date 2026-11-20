import type { FetchLike } from "@/lib/domain/constants";
import { sha256Hex } from "@/lib/domain/spec-hash";
import type { MarketSpec } from "@/lib/domain/market-spec";
import { sanitizeAndCheckPrompt } from "./guardrails";
import { callLlmJson, resolveLlmConfig, type LlmProvider } from "./llm";
import { buildMarketSystemPrompt, buildMarketUserPrompt } from "./prompt-template";
import { compilePromptRuleBased } from "./rule-compiler";
import { validateFullMarketSpec } from "./validate-spec";

export type CompileMarketResult =
  | {
      ok: true;
      spec: MarketSpec;
      specSha256: string;
      auditUrl: string | null;
      warnings: string[];
      model: string;
      promptSha256: string;
      latencyMs: number;
    }
  | {
      ok: false;
      code: "AI_SPEC_REJECTED" | "VALIDATION_FAILED";
      message: string;
      errors: string[];
      model: string;
      promptSha256: string;
      latencyMs: number;
    };

const NUMERIC_ORACLE_PARAM_KEYS = new Set(["latitude", "longitude", "startTime", "limit"]);

const OPERATOR_ALIASES: Record<string, string> = {
  gt: ">",
  greater_than: ">",
  gte: ">=",
  greater_than_or_equal: ">=",
  lt: "<",
  less_than: "<",
  lte: "<=",
  less_than_or_equal: "<=",
  eq: "==",
  equal: "==",
  equals: "==",
  ne: "!=",
  neq: "!=",
  not_equal: "!=",
  not_equals: "!=",
};

function isConfusedOracleRejection(reason: string): boolean {
  return /\b(auto_api|nostr_oracle|auto-api|provider|creator-controlled|not objectively verifiable)\b/i.test(
    reason,
  );
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Normalizes minor LLM JSON formatting quirks (1-element primitive param arrays, numeric strings,
 * word comparison operators) before running strict schema, registry, and SSRF validation.
 */
export function normalizeLlmMarketSpecCandidate(raw: unknown): unknown {
  if (!isPlainRecord(raw)) return raw;
  if (!isPlainRecord(raw.oracle_config)) return raw;

  const oracleConfig: Record<string, unknown> = { ...raw.oracle_config };

  if (isPlainRecord(oracleConfig.params)) {
    const nextParams: Record<string, unknown> = {};
    for (const [k, rawVal] of Object.entries(oracleConfig.params)) {
      let val = rawVal;
      if (
        Array.isArray(val) &&
        val.length === 1 &&
        (typeof val[0] === "string" || typeof val[0] === "number" || typeof val[0] === "boolean")
      ) {
        val = val[0];
      }
      if (NUMERIC_ORACLE_PARAM_KEYS.has(k) && typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
          val = Number(trimmed);
        }
      }
      nextParams[k] = val;
    }
    oracleConfig.params = nextParams;
  }

  if (isPlainRecord(oracleConfig.condition)) {
    const cond: Record<string, unknown> = { ...oracleConfig.condition };
    if (typeof cond.operator === "string") {
      const mapped = OPERATOR_ALIASES[cond.operator.trim().toLowerCase()];
      if (mapped) cond.operator = mapped;
    }
    if (typeof cond.threshold === "string" && /^-?\d+(\.\d+)?$/.test(cond.threshold.trim())) {
      cond.threshold = Number(cond.threshold.trim());
    }
    oracleConfig.condition = cond;
  }

  return {
    ...raw,
    oracle_config: oracleConfig,
  };
}

export async function compileMarketPrompt(opts: {
  prompt: string;
  timezone?: string;
  now?: Date;
  apiKey?: string;
  model?: string;
  provider?: LlmProvider;
  baseUrl?: string;
  fetchFn?: FetchLike;
}): Promise<CompileMarketResult> {
  const started = performance.now();
  const guard = sanitizeAndCheckPrompt(opts.prompt);
  const promptSha256 = sha256Hex(opts.prompt);

  if (!guard.ok) {
    return {
      ok: false,
      code: "AI_SPEC_REJECTED",
      message: guard.reason,
      errors: [guard.reason],
      model: "guardrails",
      promptSha256,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const now = opts.now ?? new Date();
  const userTz = opts.timezone?.trim() || "UTC";
  const llm = resolveLlmConfig({
    apiKey: opts.apiKey,
    model: opts.model,
    provider: opts.provider,
    baseUrl: opts.baseUrl,
    fetchFn: opts.fetchFn,
  });

  if (!llm) {
    const model = "rule-compiler-v1";
    const draft = compilePromptRuleBased(guard.prompt, { now, timezone: userTz });
    const validated = validateFullMarketSpec(draft, { now });
    const latencyMs = Math.round(performance.now() - started);

    if (!validated.ok) {
      return {
        ok: false,
        code: "AI_SPEC_REJECTED",
        message: validated.errors[0] ?? "Could not compile valid market spec",
        errors: validated.errors,
        model,
        promptSha256,
        latencyMs,
      };
    }

    return {
      ok: true,
      spec: validated.spec,
      specSha256: validated.specSha256,
      auditUrl: validated.auditUrl,
      warnings: validated.warnings,
      model,
      promptSha256,
      latencyMs,
    };
  }

  const model = llm.model;
  const systemPrompt = buildMarketSystemPrompt({ nowUtc: now.toISOString(), userTz });

  let previousErrors: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await callLlmJson({
        config: llm,
        systemPrompt,
        userPrompt: buildMarketUserPrompt(guard.prompt, previousErrors),
        temperature: 0,
        maxTokens: 1536,
        timeoutMs: 15_000,
        fetchFn: opts.fetchFn,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "LLM request failed";
      return {
        ok: false,
        code: "AI_SPEC_REJECTED",
        message: msg,
        errors: [msg],
        model,
        promptSha256,
        latencyMs: Math.round(performance.now() - started),
      };
    }

    if (raw && typeof raw === "object" && "error" in raw && typeof (raw as { error: unknown }).error === "string") {
      const reason = (raw as { error: string }).error;
      if (isConfusedOracleRejection(reason)) {
        if (attempt === 0) {
          previousErrors = [
            `Do NOT reject this prompt ("${reason}"). Public events such as elections, legislation, court rulings, or sports are valid prediction markets and are NOT creator-controlled. When auto_api providers do not cover the event, compile a valid MarketSpec using resolution_track="nostr_oracle" with oracle_config={ "signer_policy": "platform_signer", "suggested_sources": [...] } and timestamps within 5 years.`,
          ];
          continue;
        }
        const fallbackDraft = compilePromptRuleBased(guard.prompt, { now, timezone: userTz });
        const fallbackValidated = validateFullMarketSpec(fallbackDraft, { now });
        if (fallbackValidated.ok) {
          return {
            ok: true,
            spec: fallbackValidated.spec,
            specSha256: fallbackValidated.specSha256,
            auditUrl: fallbackValidated.auditUrl,
            warnings: fallbackValidated.warnings,
            model: `${model} (rule-fallback)`,
            promptSha256,
            latencyMs: Math.round(performance.now() - started),
          };
        }
      }
      return {
        ok: false,
        code: "AI_SPEC_REJECTED",
        message: reason,
        errors: [reason],
        model,
        promptSha256,
        latencyMs: Math.round(performance.now() - started),
      };
    }

    const validated = validateFullMarketSpec(normalizeLlmMarketSpecCandidate(raw), { now });
    if (validated.ok) {
      return {
        ok: true,
        spec: validated.spec,
        specSha256: validated.specSha256,
        auditUrl: validated.auditUrl,
        warnings: validated.warnings,
        model,
        promptSha256,
        latencyMs: Math.round(performance.now() - started),
      };
    }

    previousErrors = validated.errors;
  }

  return {
    ok: false,
    code: "AI_SPEC_REJECTED",
    message: previousErrors?.[0] ?? "AI failed to generate a valid MarketSpec after retry",
    errors: previousErrors ?? ["Validation failed"],
    model,
    promptSha256,
    latencyMs: Math.round(performance.now() - started),
  };
}
