import { and, desc, eq, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/lib/db/schema";
import type { FetchLike } from "@/lib/domain/constants";
import { impliedYesProbability } from "@/lib/domain/pool";
import { type AutoApiOracleConfig, isAutoApiConfig } from "@/lib/domain/market-spec";
import { sha256Hex } from "@/lib/domain/spec-hash";

export const INSIGHT_DISCLAIMER =
  "AI-generated, not financial advice, does not affect resolution.";

export interface InsightDataPoint {
  label: string;
  value: string;
}

export interface MarketInsight {
  summary: string;
  data_points: InsightDataPoint[];
  sources: string[];
  disclaimer: string;
  model: string;
  generated_at: string;
}

function providerDescriptor(config: AutoApiOracleConfig): {
  sourceLabel: string;
  sourceUrl: string;
  targetSummary: string;
} {
  const cond = `${config.condition.operator} ${String(config.condition.threshold)}`;
  switch (config.provider) {
    case "open-meteo":
      return {
        sourceLabel: `Open-Meteo (${String(config.params.daily ?? "daily")} on ${String(config.params.start_date ?? "")})`,
        sourceUrl: "https://open-meteo.com/",
        targetSummary: `Daily metric ${String(config.params.daily ?? "value")} ${cond}`,
      };
    case "binance":
      return {
        sourceLabel: `Binance Spot (${String(config.params.symbol ?? "BTCUSDT")} ${String(config.params.interval ?? "1m")} kline)`,
        sourceUrl: "https://www.binance.com/en/trade/BTC_USDT",
        targetSummary: `Candle close ${cond}`,
      };
    case "mempool":
      return {
        sourceLabel: `mempool.space (${String(config.params.endpoint ?? "blocks/tip/height")})`,
        sourceUrl: "https://mempool.space/",
        targetSummary: `${config.value_path === "fastestFee" ? "Fastest fee (sat/vB)" : "Block tip height"} ${cond}`,
      };
    case "coingecko":
      return {
        sourceLabel: `CoinGecko (${String(config.params.ids ?? "bitcoin")}/${String(config.params.vs_currencies ?? "usd")})`,
        sourceUrl: "https://www.coingecko.com/",
        targetSummary: `Spot price ${cond}`,
      };
    case "frankfurter":
      return {
        sourceLabel: `ECB / Frankfurter (${String(config.params.from ?? "EUR")}/${String(config.params.to ?? "USD")})`,
        sourceUrl: "https://www.frankfurter.app/",
        targetSummary: `FX rate ${cond} on ${String(config.params.date ?? "latest")}`,
      };
    case "github":
      return {
        sourceLabel: `GitHub API (${String(config.params.owner ?? "")}/${String(config.params.repo ?? "")})`,
        sourceUrl: `https://github.com/${String(config.params.owner ?? "")}/${String(config.params.repo ?? "")}`,
        targetSummary: `${config.value_path} ${cond}`,
      };
    case "thesportsdb":
      return {
        sourceLabel: `TheSportsDB (Event #${String(config.params.id ?? "")})`,
        sourceUrl: "https://www.thesportsdb.com/",
        targetSummary: `${config.value_path} ${cond}`,
      };
    case "opendota":
      return {
        sourceLabel: `OpenDota (Match #${String(config.params.match_id ?? "")})`,
        sourceUrl: "https://www.opendota.com/",
        targetSummary: `${config.value_path} ${cond}`,
      };
  }
}

function buildDeterministicInsight(market: schema.Market, nowIso: string): MarketInsight {
  const spec = market.spec;
  const totalMsat = market.poolYesMsat + market.poolNoMsat;
  const yesProb = impliedYesProbability(market.poolYesMsat, market.poolNoMsat);
  const totalSats = Math.floor(totalMsat / 1000);
  const yesPct = Math.round(yesProb * 100);
  const noPct = 100 - yesPct;

  const dataPoints: InsightDataPoint[] = [
    {
      label: "Market Odds",
      value: `${yesPct}% YES / ${noPct}% NO (${totalSats.toLocaleString("en-US")} sats pool)`,
    },
    {
      label: "Deadline (UTC)",
      value: spec.deadline_utc.replace("T", " ").slice(0, 16) + " UTC",
    },
  ];

  let sources: string[] = [];
  let summary = "";

  if (isAutoApiConfig(spec.oracle_config)) {
    const desc = providerDescriptor(spec.oracle_config);
    sources = [desc.sourceLabel, desc.sourceUrl];
    dataPoints.push(
      { label: "Oracle Track", value: `Track A · Auto-API (${spec.oracle_config.provider})` },
      { label: "Target Check", value: desc.targetSummary },
    );
    summary = `This ${market.category} market settles deterministically via ${desc.sourceLabel} checking ${desc.targetSummary}. Current pool implies ${yesPct}% YES across ${totalSats.toLocaleString("en-US")} sats staked; payout ratio moves purely on final pool share before cutoff.`;
  } else {
    sources =
      spec.oracle_config.suggested_sources.length > 0
        ? [...spec.oracle_config.suggested_sources]
        : ["Official primary announcements"];
    dataPoints.push(
      { label: "Oracle Track", value: `Track B · Nostr Signer (${spec.oracle_config.signer_policy})` },
      { label: "Challenge Window", value: "Optimistic proposal + bond dispute period" },
    );
    summary = `This ${market.category} market resolves via an allowlisted Nostr oracle signer citing primary sources (${sources.slice(0, 2).join(", ")}) with an optimistic challenge window before payout. Current pool implies ${yesPct}% YES across ${totalSats.toLocaleString("en-US")} sats staked.`;
  }

  return {
    summary,
    data_points: dataPoints,
    sources,
    disclaimer: INSIGHT_DISCLAIMER,
    model: "insight-brief-v1",
    generated_at: nowIso,
  };
}

export async function getOrGenerateMarketInsight(
  db: LibSQLDatabase<typeof schema>,
  marketIdOrSlug: string,
  opts: { apiKey?: string; fetchFn?: FetchLike } = {},
): Promise<MarketInsight | null> {
  const mktRows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, marketIdOrSlug), eq(schema.markets.slug, marketIdOrSlug)))
    .limit(1);

  const market = mktRows[0];
  if (!market) return null;

  const cachedRows = await db
    .select()
    .from(schema.aiRuns)
    .where(
      and(
        eq(schema.aiRuns.marketId, market.id),
        eq(schema.aiRuns.purpose, "insight"),
        eq(schema.aiRuns.valid, true),
      ),
    )
    .orderBy(desc(schema.aiRuns.createdAt))
    .limit(1);

  if (cachedRows[0]?.output) {
    return cachedRows[0].output as MarketInsight;
  }

  const started = performance.now();
  const nowIso = new Date().toISOString();
  const baseline = buildDeterministicInsight(market, nowIso);
  const promptText = `Market: ${market.spec.question}\nCategory: ${market.category}\nTrack: ${market.track}\nRules: ${market.spec.rules}\nDeadline: ${market.spec.deadline_utc}\nSources: ${baseline.sources.join(", ")}`;
  const promptSha256 = sha256Hex(promptText);

  const apiKey = (opts.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
  let result: MarketInsight = baseline;

  if (apiKey) {
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    const fetchImpl = opts.fetchFn ?? fetch;
    try {
      const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: `You write concise, neutral informational context briefs for prediction markets. Never give betting advice or predict guaranteed winners. Output strict JSON: { "summary": string (2-3 sentences), "data_points": [{ "label": string, "value": string }], "sources": string[] }.`,
                },
              ],
            },
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const parsed = JSON.parse(rawText) as Partial<MarketInsight>;
          if (typeof parsed.summary === "string" && parsed.summary.trim().length > 10) {
            const validPoints = Array.isArray(parsed.data_points)
              ? parsed.data_points.filter(
                  (d): d is InsightDataPoint =>
                    Boolean(d) &&
                    typeof d.label === "string" &&
                    d.label.trim().length > 0 &&
                    typeof d.value === "string" &&
                    d.value.trim().length > 0,
                )
              : [];
            const validSources = Array.isArray(parsed.sources)
              ? parsed.sources.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              : [];

            result = {
              summary: parsed.summary.trim(),
              data_points: validPoints.length > 0 ? validPoints.slice(0, 6) : baseline.data_points,
              sources: validSources.length > 0 ? validSources.slice(0, 6) : baseline.sources,
              disclaimer: INSIGHT_DISCLAIMER,
              model,
              generated_at: nowIso,
            };
          }
        }
      }
    } catch {
      // Deterministic baseline remains fallback when Gemini is unreachable
    }
  }

  await db.insert(schema.aiRuns).values({
    purpose: "insight",
    marketId: market.id,
    model: result.model,
    promptSha256,
    input: {
      question: market.spec.question,
      category: market.category,
      track: market.track,
    },
    output: result,
    valid: true,
    latencyMs: Math.round(performance.now() - started),
  });

  return result;
}
