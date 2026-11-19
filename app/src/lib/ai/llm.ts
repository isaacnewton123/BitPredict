import type { FetchLike } from "@/lib/domain/constants";

export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export type LlmProvider = "nvidia" | "gemini";

export interface ResolvedLlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface ResolveLlmOptions {
  apiKey?: string;
  model?: string;
  provider?: LlmProvider;
  baseUrl?: string;
  fetchFn?: FetchLike;
}

function buildConfig(
  provider: LlmProvider,
  apiKey: string,
  opts: ResolveLlmOptions,
): ResolvedLlmConfig {
  if (provider === "nvidia") {
    const rawBaseUrl =
      opts.baseUrl?.trim() ||
      process.env.NVIDIA_BASE_URL?.trim() ||
      DEFAULT_NVIDIA_BASE_URL;
    return {
      provider: "nvidia",
      apiKey,
      model:
        opts.model?.trim() ||
        process.env.NVIDIA_MODEL?.trim() ||
        DEFAULT_NVIDIA_MODEL,
      baseUrl: rawBaseUrl.replace(/\/+$/, ""),
    };
  }

  return {
    provider: "gemini",
    apiKey,
    model:
      opts.model?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      DEFAULT_GEMINI_MODEL,
  };
}

/**
 * Resolves the active LLM provider configuration from explicit call options or process env.
 * Returns null in offline Vitest runs unless a mock fetchFn or explicit apiKey is supplied.
 */
export function resolveLlmConfig(
  opts: ResolveLlmOptions = {},
): ResolvedLlmConfig | null {
  if (opts.apiKey !== undefined) {
    const trimmedKey = opts.apiKey.trim();
    if (!trimmedKey) return null;
    const provider =
      opts.provider ?? (trimmedKey.startsWith("nvapi-") ? "nvidia" : "gemini");
    return buildConfig(provider, trimmedKey, opts);
  }

  if (process.env.VITEST === "true" && !opts.fetchFn) {
    return null;
  }

  const preferred =
    opts.provider ?? (process.env.AI_PROVIDER?.trim().toLowerCase() || "auto");
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();

  if ((preferred === "nvidia" || preferred === "auto") && nvidiaKey) {
    return buildConfig("nvidia", nvidiaKey, opts);
  }
  if ((preferred === "gemini" || preferred === "auto") && geminiKey) {
    return buildConfig("gemini", geminiKey, opts);
  }

  return null;
}

/** Strips optional Markdown code fences around JSON payloads. */
export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Calls either NVIDIA NIM (OpenAI-compatible) or Google Gemini and parses the JSON response. */
export async function callLlmJson(opts: {
  config: ResolvedLlmConfig;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  if (opts.config.provider === "nvidia") {
    const baseUrl = (opts.config.baseUrl ?? DEFAULT_NVIDIA_BASE_URL).replace(
      /\/+$/,
      "",
    );
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.config.apiKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: opts.config.model,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxTokens ?? 1536,
        response_format: { type: "json_object" },
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Empty LLM response");
    }
    return JSON.parse(extractJsonText(text));
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    opts.config.model,
  )}:generateContent?key=${encodeURIComponent(opts.config.apiKey)}`;

  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0,
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
  return JSON.parse(extractJsonText(text));
}
