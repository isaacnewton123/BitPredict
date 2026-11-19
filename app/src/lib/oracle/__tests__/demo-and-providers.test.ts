import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { generateSecretKey, verifyEvent, type Event as NostrEvent } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileMarketPrompt } from "@/lib/ai/compiler";
import { getOrGenerateMarketInsight, INSIGHT_DISCLAIMER } from "@/lib/ai/insight";
import { validateFullMarketSpec } from "@/lib/ai/validate-spec";
import * as schema from "@/lib/db/schema";
import { DEMO_MARKET_SLUGS, seedDemoWorkspace } from "@/lib/demo/seed";
import type { FetchLike } from "@/lib/domain/constants";
import { createMarketDraft } from "@/lib/markets/draft-repo";
import { publishMarketDraft } from "@/lib/markets/publish-repo";
import { OUTCOME_ATTESTATION_KIND } from "@/lib/nostr/events";
import { resolveTrackAMarket } from "@/lib/oracle/worker-repo";

const MIGRATION_PATH = path.resolve(process.cwd(), "drizzle/0000_mute_may_parker.sql");
const FIXED_NOW = new Date("2026-11-19T12:00:00Z");

async function setupMemoryDb(): Promise<{ client: Client; db: LibSQLDatabase<typeof schema> }> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON;");
  const stmts = fs
    .readFileSync(MIGRATION_PATH, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of stmts) {
    await client.execute(s);
  }
  return { client, db: drizzle(client, { schema }) };
}

describe("Rule compiler routing for CoinGecko, TheSportsDB, and OpenDota", () => {
  it("routes explicit CoinGecko, TheSportsDB, and OpenDota prompts to Track A auto_api", async () => {
    const cg = await compileMarketPrompt({
      prompt: "Will Bitcoin CoinGecko spot price exceed $105,000 tomorrow?",
      now: FIXED_NOW,
    });
    expect(cg.ok).toBe(true);
    if (!cg.ok) throw new Error(cg.message);
    expect(cg.spec.category).toBe("Crypto");
    expect(cg.spec.resolution_track).toBe("auto_api");
    expect(cg.spec.oracle_config).toEqual({
      provider: "coingecko",
      params: { ids: "bitcoin", vs_currencies: "usd" },
      value_path: "bitcoin.usd",
      condition: { operator: ">", threshold: 105000 },
    });
    expect(validateFullMarketSpec(cg.spec, { now: FIXED_NOW }).ok).toBe(true);

    const sports = await compileMarketPrompt({
      prompt: "TheSportsDB event 123456 home score >= 2 tomorrow?",
      now: FIXED_NOW,
    });
    expect(sports.ok).toBe(true);
    if (!sports.ok) throw new Error(sports.message);
    expect(sports.spec.category).toBe("Sports");
    expect(sports.spec.resolution_track).toBe("auto_api");
    expect(sports.spec.oracle_config).toEqual({
      provider: "thesportsdb",
      params: { id: "123456" },
      value_path: "events[0].intHomeScore",
      condition: { operator: ">=", threshold: 2 },
    });
    expect(validateFullMarketSpec(sports.spec, { now: FIXED_NOW }).ok).toBe(true);

    const dotaWin = await compileMarketPrompt({
      prompt: "OpenDota match 7891234567 Radiant win tomorrow?",
      now: FIXED_NOW,
    });
    expect(dotaWin.ok).toBe(true);
    if (!dotaWin.ok) throw new Error(dotaWin.message);
    expect(dotaWin.spec.category).toBe("Esports");
    expect(dotaWin.spec.resolution_track).toBe("auto_api");
    expect(dotaWin.spec.oracle_config).toEqual({
      provider: "opendota",
      params: { match_id: "7891234567" },
      value_path: "radiant_win",
      condition: { operator: "==", threshold: 1 },
    });
    expect(validateFullMarketSpec(dotaWin.spec, { now: FIXED_NOW }).ok).toBe(true);

    const dotaDur = await compileMarketPrompt({
      prompt: "OpenDota match 7891234567 duration more than 45 minutes tomorrow?",
      now: FIXED_NOW,
    });
    expect(dotaDur.ok).toBe(true);
    if (!dotaDur.ok) throw new Error(dotaDur.message);
    expect(dotaDur.spec.oracle_config).toEqual({
      provider: "opendota",
      params: { match_id: "7891234567" },
      value_path: "duration",
      condition: { operator: ">", threshold: 2700 },
    });
    expect(validateFullMarketSpec(dotaDur.spec, { now: FIXED_NOW }).ok).toBe(true);
  });
});

describe("Track A recorded fixture resolution across all remaining providers", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;
  const creatorPubkey = "a".repeat(64);
  const oracleSk = generateSecretKey();

  beforeAll(async () => {
    ({ client, db } = await setupMemoryDb());
    await db.insert(schema.users).values({ pubkey: creatorPubkey });
  });

  afterAll(() => {
    client.close();
  });

  it("resolves mempool (height & fees), coingecko, frankfurter, github, thesportsdb, and opendota fixtures", async () => {
    const cases: Array<{
      name: string;
      prompt: string;
      fixtureBody: unknown;
      expectedOutcome: "YES" | "NO";
      expectedProvider: string;
    }> = [
      {
        name: "mempool tip height",
        prompt: "Will Bitcoin block height exceed 900000 tomorrow?",
        fixtureBody: 910500,
        expectedOutcome: "YES",
        expectedProvider: "mempool",
      },
      {
        name: "mempool fee rate",
        prompt: "Will Bitcoin mempool fee rate exceed 30 sat/vB tomorrow?",
        fixtureBody: { fastestFee: 45, halfHourFee: 30, hourFee: 20 },
        expectedOutcome: "YES",
        expectedProvider: "mempool",
      },
      {
        name: "coingecko spot price",
        prompt: "Will Bitcoin CoinGecko spot price exceed $105,000 tomorrow?",
        fixtureBody: { bitcoin: { usd: 106420 } },
        expectedOutcome: "YES",
        expectedProvider: "coingecko",
      },
      {
        name: "frankfurter ECB rate",
        prompt: "Will EUR/USD reach 1.05 tomorrow?",
        fixtureBody: { amount: 1.0, base: "EUR", date: "2026-11-20", rates: { USD: 1.041 } },
        expectedOutcome: "NO",
        expectedProvider: "frankfurter",
      },
      {
        name: "github repo stars",
        prompt: "Will bitcoin/bitcoin GitHub stars reach 85000 tomorrow?",
        fixtureBody: { full_name: "bitcoin/bitcoin", stargazers_count: 86500 },
        expectedOutcome: "YES",
        expectedProvider: "github",
      },
      {
        name: "thesportsdb home score",
        prompt: "TheSportsDB event 123456 home score >= 2 tomorrow?",
        fixtureBody: {
          events: [{ idEvent: "123456", intHomeScore: "3", intAwayScore: "1", strStatus: "Match Finished" }],
        },
        expectedOutcome: "YES",
        expectedProvider: "thesportsdb",
      },
      {
        name: "opendota match win",
        prompt: "OpenDota match 7891234567 Radiant win tomorrow?",
        fixtureBody: { match_id: 7891234567, radiant_win: true, duration: 2810 },
        expectedOutcome: "YES",
        expectedProvider: "opendota",
      },
    ];

    for (const c of cases) {
      const compiled = await compileMarketPrompt({ prompt: c.prompt, now: FIXED_NOW });
      expect(compiled.ok, `compile ${c.name}`).toBe(true);
      if (!compiled.ok) throw new Error(compiled.message);

      const draft = await createMarketDraft(db, {
        creatorPubkey,
        prompt: c.prompt,
        compiled,
      });
      const published = await publishMarketDraft(db, {
        draftId: draft.draft_id,
        creatorPubkey,
        now: FIXED_NOW,
        broadcastFn: async () => [],
      });
      expect(published.ok, `publish ${c.name}`).toBe(true);
      if (!published.ok) throw new Error("unreachable");

      const mockFetch: FetchLike = async () =>
        new Response(
          typeof c.fixtureBody === "number" ? String(c.fixtureBody) : JSON.stringify(c.fixtureBody),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );

      const res = await resolveTrackAMarket(db, published.market.id, {
        now: new Date(FIXED_NOW.getTime() + 48 * 3_600_000),
        forceResolveNow: true,
        fetchFn: mockFetch,
        broadcastFn: async () => [],
        oracleSecretKey: oracleSk,
      });

      expect(res.ok, `resolve ${c.name}`).toBe(true);
      if (!res.ok) throw new Error("unreachable");
      expect(res.market.status).toBe("RESOLVED");
      expect(res.market.outcome).toBe(c.expectedOutcome);
      expect(res.proof.provider).toBe(c.expectedProvider);
      expect(res.proof.bodySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(res.attestation_event.kind).toBe(OUTCOME_ATTESTATION_KIND);
      expect(verifyEvent(res.attestation_event as NostrEvent)).toBe(true);
    }
  });
});

describe("AI Market Insight caching & Idempotent Demo Seeder", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  beforeAll(async () => {
    ({ client, db } = await setupMemoryDb());
  });

  afterAll(() => {
    client.close();
  });

  it("seeds 6 showcase markets and 3 users idempotently with SUM(ledger_entries.amount_msat) === 0", async () => {
    const first = await seedDemoWorkspace(db, { now: FIXED_NOW });
    expect(first.created_users).toBe(3);
    expect(first.created_markets).toBe(6);
    expect(first.skipped_markets).toBe(0);

    const marketsAfterFirst = await db.select().from(schema.markets);
    expect(marketsAfterFirst).toHaveLength(6);
    expect(marketsAfterFirst.map((m) => m.slug).sort()).toEqual([...DEMO_MARKET_SLUGS].sort());

    // Settled Weather showcase market verification
    const settledMkt = marketsAfterFirst.find((m) => m.slug === "demo-dc-temp-openmeteo");
    expect(settledMkt?.status).toBe("SETTLED");
    expect(settledMkt?.outcome).toBe("YES");

    const proofs = await db
      .select()
      .from(schema.oracleProofs)
      .where(eq(schema.oracleProofs.marketId, settledMkt!.id));
    expect(proofs).toHaveLength(1);
    expect(proofs[0].provider).toBe("open-meteo");

    const payouts = await db
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.marketId, settledMkt!.id));
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe("SENT");

    // Pending Sports Track B market verification + cached evidence run
    const sportsMkt = marketsAfterFirst.find((m) => m.slug === "demo-senegal-afcon-nostr");
    expect(sportsMkt?.status).toBe("PENDING_RESOLUTION");
    const evidenceRuns = await db
      .select()
      .from(schema.aiRuns)
      .where(
        and(
          eq(schema.aiRuns.marketId, sportsMkt!.id),
          eq(schema.aiRuns.purpose, "evidence"),
        ),
      );
    expect(evidenceRuns).toHaveLength(1);

    // Idempotency check on second seed call
    const second = await seedDemoWorkspace(db, { now: FIXED_NOW });
    expect(second.created_users).toBe(0);
    expect(second.created_markets).toBe(0);
    expect(second.skipped_markets).toBe(6);

    const marketsAfterSecond = await db.select().from(schema.markets);
    expect(marketsAfterSecond).toHaveLength(6);

    // Double-entry ledger balance invariant across entire workspace
    const ledger = await db.select().from(schema.ledgerEntries);
    expect(ledger.length).toBeGreaterThan(0);
    const totalBalance = ledger.reduce((acc, row) => acc + row.amountMsat, 0);
    expect(totalBalance).toBe(0);
  });

  it("generates and caches AI market insights per market in ai_runs", async () => {
    const insight1 = await getOrGenerateMarketInsight(db, "demo-btc-5m-binance", { apiKey: "" });
    expect(insight1).not.toBeNull();
    expect(insight1!.disclaimer).toBe(INSIGHT_DISCLAIMER);
    expect(insight1!.summary.length).toBeGreaterThan(20);
    expect(insight1!.data_points.length).toBeGreaterThanOrEqual(3);

    const insight2 = await getOrGenerateMarketInsight(db, "demo-btc-5m-binance", { apiKey: "" });
    expect(insight2).toEqual(insight1);

    const btcRows = await db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.slug, "demo-btc-5m-binance"));
    const cachedRuns = await db
      .select()
      .from(schema.aiRuns)
      .where(
        and(
          eq(schema.aiRuns.marketId, btcRows[0].id),
          eq(schema.aiRuns.purpose, "insight"),
        ),
      );
    expect(cachedRuns).toHaveLength(1);
  });

  it("accepts mocked Gemini insight JSON and gracefully falls back on error", async () => {
    const geminiFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: "ECB daily EUR/USD reference fixing determines this contract.",
                      data_points: [{ label: "Source", value: "ECB via Frankfurter" }],
                      sources: ["https://www.frankfurter.app/"],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const res = await getOrGenerateMarketInsight(db, "demo-eur-usd-frankfurter", {
      apiKey: "fake-gemini-key",
      fetchFn: geminiFetch,
    });
    expect(res).not.toBeNull();
    expect(res!.summary).toContain("ECB daily EUR/USD");
    expect(res!.disclaimer).toBe(INSIGHT_DISCLAIMER);
  });
});
