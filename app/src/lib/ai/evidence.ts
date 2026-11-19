import { and, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/lib/db/schema";
import type { FetchLike } from "@/lib/domain/constants";
import { isAutoApiConfig } from "@/lib/domain/market-spec";
import { sha256Hex } from "@/lib/domain/spec-hash";
import { callLlmJson, resolveLlmConfig, type LlmProvider } from "./llm";

export interface EvidenceSummary {
  summary: string;
  leaning: "YES" | "NO" | "UNCLEAR";
  sources: string[];
  model: string;
  generated_at: string;
}

export async function getOrGenerateEvidenceSummary(
  db: LibSQLDatabase<typeof schema>,
  marketId: string,
  opts: {
    apiKey?: string;
    model?: string;
    provider?: LlmProvider;
    baseUrl?: string;
    fetchFn?: FetchLike;
  } = {},
): Promise<EvidenceSummary | null> {
  const cachedRows = await db
    .select()
    .from(schema.aiRuns)
    .where(
      and(
        eq(schema.aiRuns.marketId, marketId),
        eq(schema.aiRuns.purpose, "evidence"),
        eq(schema.aiRuns.valid, true),
      ),
    )
    .orderBy(desc(schema.aiRuns.createdAt))
    .limit(1);

  if (cachedRows[0]?.output) {
    return cachedRows[0].output as EvidenceSummary;
  }

  const mktRows = await db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId))
    .limit(1);
  const market = mktRows[0];
  if (!market) return null;

  const sources = !isAutoApiConfig(market.spec.oracle_config)
    ? market.spec.oracle_config.suggested_sources
    : [];

  const started = performance.now();
  const nowIso = new Date().toISOString();
  const promptText = `Question: ${market.spec.question}\nRules: ${market.spec.rules}\nDeadline: ${market.spec.deadline_utc}\nSources: ${sources.join(", ")}`;
  const promptSha256 = sha256Hex(promptText);

  const llm = resolveLlmConfig({
    apiKey: opts.apiKey,
    model: opts.model,
    provider: opts.provider,
    baseUrl: opts.baseUrl,
    fetchFn: opts.fetchFn,
  });
  let result: EvidenceSummary | null = null;

  if (llm) {
    try {
      const parsed = (await callLlmJson({
        config: llm,
        systemPrompt:
          'You are an evidence summarizer for a human Nostr Oracle Signer. Summarize what must be checked to resolve the market objectively, list sources, and output JSON { "summary": string, "leaning": "YES"|"NO"|"UNCLEAR", "sources": string[] }. Never fabricate facts — if live outcome data is not directly provided, use leaning "UNCLEAR".',
        userPrompt: promptText,
        temperature: 0,
        maxTokens: 768,
        timeoutMs: 10_000,
        fetchFn: opts.fetchFn,
      })) as Partial<EvidenceSummary>;
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        result = {
          summary: parsed.summary.trim(),
          leaning:
            parsed.leaning === "YES" || parsed.leaning === "NO"
              ? parsed.leaning
              : "UNCLEAR",
          sources:
            Array.isArray(parsed.sources) && parsed.sources.length > 0
              ? parsed.sources
              : sources,
          model: llm.model,
          generated_at: nowIso,
        };
      }
    } catch {
      // Fall back to deterministic summary below
    }
  }

  if (!result) {
    result = {
      summary: `Informational verification brief for "${market.spec.question}": Verify primary outcome against ${sources.join("; ") || "official releases"} after ${market.spec.deadline_utc}. Resolution criteria: ${market.spec.rules}`,
      leaning: "UNCLEAR",
      sources,
      model: "evidence-brief-v1",
      generated_at: nowIso,
    };
  }

  await db.insert(schema.aiRuns).values({
    purpose: "evidence",
    marketId: market.id,
    model: result.model,
    promptSha256,
    input: { question: market.spec.question, sources },
    output: result,
    valid: true,
    latencyMs: Math.round(performance.now() - started),
  });

  return result;
}
