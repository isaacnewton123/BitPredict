import type { FetchLike } from "@/lib/domain/constants";
import { sha256Hex } from "@/lib/domain/spec-hash";
import type { MarketSpec } from "@/lib/domain/market-spec";
import { sanitizeAndCheckPrompt } from "./guardrails";
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

async function callGeminiJson(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  fetchFn: FetchLike;
}): Promise<unknown> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    opts.model,
  )}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  const res = await opts.fetchFn(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Empty LLM response");
  }
  return JSON.parse(text);
}

export async function compileMarketPrompt(opts: {
  prompt: string;
  timezone?: string;
  now?: Date;
  apiKey?: string;
  model?: string;
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
  const apiKey = (opts.apiKey ?? process.env.GEMINI_API_KEY)?.trim();

  if (!apiKey) {
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

  const model = opts.model ?? process.env.GEMINI_MODEL?.trim() ?? "gemini-2.5-flash";
  const fetchFn = opts.fetchFn ?? fetch;
  const systemPrompt = buildMarketSystemPrompt({ nowUtc: now.toISOString(), userTz });

  let previousErrors: string[] | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await callGeminiJson({
        apiKey,
        model,
        systemPrompt,
        userPrompt: buildMarketUserPrompt(guard.prompt, previousErrors),
        fetchFn,
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

    const validated = validateFullMarketSpec(raw, { now });
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
