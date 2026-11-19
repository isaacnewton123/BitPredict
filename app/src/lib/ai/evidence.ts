import { and, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/lib/db/schema";
import type { FetchLike } from "@/lib/domain/constants";
import { isAutoApiConfig } from "@/lib/domain/market-spec";
import { sha256Hex } from "@/lib/domain/spec-hash";

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
  opts: { apiKey?: string; fetchFn?: FetchLike } = {},
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

  const apiKey = (opts.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
  let result: EvidenceSummary | null = null;

  if (apiKey) {
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    const fetchImpl = opts.fetchFn ?? fetch;
    try {
      const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: `You are an evidence summarizer for a human Nostr Oracle Signer. Summarize what must be checked to resolve the market objectively, list sources, and output JSON { "summary": string, "leaning": "YES"|"NO"|"UNCLEAR", "sources": string[] }. Never fabricate facts — if live outcome data is not directly provided, use leaning "UNCLEAR".`,
                },
              ],
            },
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0, responseMimeType: "application/json" },
          }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const parsed = JSON.parse(rawText) as Partial<EvidenceSummary>;
          if (typeof parsed.summary === "string" && parsed.summary.trim()) {
            result = {
              summary: parsed.summary.trim(),
              leaning:
                parsed.leaning === "YES" || parsed.leaning === "NO" ? parsed.leaning : "UNCLEAR",
              sources: Array.isArray(parsed.sources) && parsed.sources.length > 0 ? parsed.sources : sources,
              model,
              generated_at: nowIso,
            };
          }
        }
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
