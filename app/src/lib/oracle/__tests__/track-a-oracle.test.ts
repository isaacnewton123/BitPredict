import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { generateSecretKey, verifyEvent, type Event as NostrEvent } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileMarketPrompt } from "@/lib/ai/compiler";
import * as schema from "@/lib/db/schema";
import { canonicalizeJson } from "@/lib/domain/canonical-json";
import type { FetchLike } from "@/lib/domain/constants";
import { sha256Hex } from "@/lib/domain/spec-hash";
import { createMarketDraft } from "@/lib/markets/draft-repo";
import { publishMarketDraft } from "@/lib/markets/publish-repo";
import { OUTCOME_ATTESTATION_KIND } from "@/lib/nostr/events";
import { evaluateOracleCondition, extractValueAtPath } from "@/lib/oracle/evaluator";
import { getMarketProofBundleFromDb, runOracleTick } from "@/lib/oracle/worker-repo";

const MIGRATION_PATH = path.resolve(process.cwd(), "drizzle/0000_mute_may_parker.sql");
const FIXED_NOW = new Date("2026-11-19T12:00:00Z");

describe("Track A JSON path extractor & condition evaluator", () => {
  it("extracts values from all provider payload shapes and blocks prototype keys", () => {
    expect(extractValueAtPath({ daily: { temperature_2m_max: [19.4] } }, "daily.temperature_2m_max[0]")).toBe(19.4);
    expect(extractValueAtPath([[1700000, "99000", "102000", "98500", "101250.50", "5.2"]], "[0][4]")).toBe("101250.50");
    expect(extractValueAtPath(950123, "$")).toBe(950123);
    expect(extractValueAtPath({ fastestFee: 24 }, "fastestFee")).toBe(24);
    expect(extractValueAtPath({ rates: { USD: 1.095 } }, "rates.USD")).toBe(1.095);
    expect(extractValueAtPath({ stargazers_count: 86200 }, "stargazers_count")).toBe(86200);
    expect(extractValueAtPath({ radiant_win: true }, "radiant_win")).toBe(true);
    expect(extractValueAtPath({ events: [{ intHomeScore: "3" }] }, "events[0].intHomeScore")).toBe("3");

    expect(extractValueAtPath({ a: 1 }, "__proto__.polluted")).toBeNull();
    expect(extractValueAtPath({ daily: {} }, "daily.temperature_2m_max[0]")).toBeNull();
  });

  it("evaluates all 6 comparison operators with numeric, string, and boolean coercion", () => {
    expect(evaluateOracleCondition("101250.50", { operator: ">", threshold: 100000 })).toBe("YES");
    expect(evaluateOracleCondition("99999.99", { operator: ">", threshold: 100000 })).toBe("NO");
    expect(evaluateOracleCondition(19.0, { operator: ">=", threshold: 19.0 })).toBe("YES");
    expect(evaluateOracleCondition(18.9, { operator: ">=", threshold: 19.0 })).toBe("NO");
    expect(evaluateOracleCondition(1.08, { operator: "<", threshold: 1.1 })).toBe("YES");
    expect(evaluateOracleCondition(1.1, { operator: "<=", threshold: 1.1 })).toBe("YES");
    expect(evaluateOracleCondition(19.0000000001, { operator: "==", threshold: 19.0 })).toBe("YES");
    expect(evaluateOracleCondition(20, { operator: "!=", threshold: 19 })).toBe("YES");
    expect(evaluateOracleCondition(true, { operator: "==", threshold: 1 })).toBe("YES");
    expect(evaluateOracleCondition(false, { operator: "==", threshold: 1 })).toBe("NO");
  });
});

describe("Track A Oracle Worker (runOracleTick & resolveTrackAMarket)", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  const creatorPubkey = "1".repeat(64);
  const oracleSk = generateSecretKey();

  beforeAll(async () => {
    client = createClient({ url: ":memory:" });
    await client.execute("PRAGMA foreign_keys = ON;");
    const stmts = fs
      .readFileSync(MIGRATION_PATH, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) await client.execute(s);
    db = drizzle(client, { schema });
    await db.insert(schema.users).values({ pubkey: creatorPubkey });
  });

  afterAll(() => {
    client.close();
  });

  async function publishSampleMarket(prompt: string, tz = "UTC") {
    const compiled = await compileMarketPrompt({
      prompt,
      timezone: tz,
      now: FIXED_NOW,
      apiKey: "",
    });
    if (!compiled.ok) throw new Error(`Compile failed for ${prompt}`);
    const draft = await createMarketDraft(db, {
      creatorPubkey,
      prompt,
      timezone: tz,
      compiled,
    });
    const pub = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      now: FIXED_NOW,
      broadcastFn: async () => [],
    });
    if (!pub.ok) throw new Error(`Publish failed for ${prompt}`);
    return pub.market;
  }

  it("closes a 5-minute BTC market at cutoff and resolves it at resolveAfter with raw proof & Kind 30079 attestation", async () => {
    const btcMarket = await publishSampleMarket("Will BTC be above $100,000 in 5 minutes?");

    // At T + 4m10s (past cutoff, before resolve_after): transitions OPEN -> CLOSED
    const atCutoff = new Date(btcMarket.bettingCutoff.getTime() + 1_000);
    const tick1 = await runOracleTick(db, {
      now: atCutoff,
      oracleSecretKey: oracleSk,
      broadcastFn: async () => [],
    });
    expect(tick1.closed_count).toBe(1);
    expect(tick1.resolved_track_a).toEqual([]);

    const afterClose = await db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, btcMarket.id));
    expect(afterClose[0].status).toBe("CLOSED");

    // At T + 6m10s (past resolve_after): fetches Binance kline and resolves YES
    const binanceBody = [[1795092300000, "100100.00", "101500.00", "99950.00", "101250.50", "12.5"]];
    const tick2 = await runOracleTick(db, {
      now: new Date(btcMarket.resolveAfter.getTime() + 1_000),
      oracleSecretKey: oracleSk,
      broadcastFn: async (_ev, relays) => relays.slice(0, 1),
      fetchFn: async () =>
        new Response(JSON.stringify(binanceBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(tick2.resolved_track_a).toContain(btcMarket.id);

    const bundle = await getMarketProofBundleFromDb(db, btcMarket.id);
    expect(bundle?.market.status).toBe("RESOLVED");
    expect(bundle?.market.outcome).toBe("YES");
    expect(bundle?.proofs[0].value).toBe("101250.50");
    expect(bundle?.proofs[0].bodySha256).toBe(sha256Hex(canonicalizeJson(binanceBody)));

    expect(bundle?.attestation_event?.kind).toBe(OUTCOME_ATTESTATION_KIND);
    const attEvent = bundle?.attestation_event?.event as NostrEvent;
    expect(verifyEvent(attEvent)).toBe(true);
    expect(attEvent.tags).toContainEqual(["outcome", "YES"]);
    expect(attEvent.tags).toContainEqual(["proof_sha256", sha256Hex(canonicalizeJson(binanceBody))]);
  });

  it("resolves Washington weather markets to YES (19.4°C) and NO (17.2°C)", async () => {
    const mYes = await publishSampleMarket(
      "Will the maximum temperature in Washington city reach 19°C tomorrow?",
      "America/New_York",
    );
    const mNo = await publishSampleMarket(
      "Will the maximum temperature in London reach 19°C tomorrow?",
      "Europe/London",
    );

    const resolveTime = new Date("2026-11-21T08:00:00Z");
    await runOracleTick(db, {
      now: resolveTime,
      oracleSecretKey: oracleSk,
      broadcastFn: async () => [],
      fetchFn: async (url) => {
        const isDc = String(url).includes("38.9072");
        return new Response(
          JSON.stringify({
            daily: { temperature_2m_max: [isDc ? 19.4 : 17.2] },
          }),
          { status: 200 },
        );
      },
    });

    const yesRow = (await getMarketProofBundleFromDb(db, mYes.id))?.market;
    const noRow = (await getMarketProofBundleFromDb(db, mNo.id))?.market;
    expect(yesRow?.status).toBe("RESOLVED");
    expect(yesRow?.outcome).toBe("YES");
    expect(noRow?.status).toBe("RESOLVED");
    expect(noRow?.outcome).toBe("NO");
  });

  it("retries on API error in RESOLVING and transitions to VOID after 24h timeout", async () => {
    const failingMkt = await publishSampleMarket("Will ETH exceed $4,500 on 2026-12-15?");
    const errorFetch: FetchLike = async () => new Response("Upstream error", { status: 500 });

    // 1) Resolve_after + 10m: stays RESOLVING and logs diagnostic proof
    const retryTick = await runOracleTick(db, {
      now: new Date(failingMkt.resolveAfter.getTime() + 10 * 60_000),
      oracleSecretKey: oracleSk,
      broadcastFn: async () => [],
      fetchFn: errorFetch,
    });
    expect(retryTick.retrying_track_a).toContain(failingMkt.id);
    const midState = await getMarketProofBundleFromDb(db, failingMkt.id);
    expect(midState?.market.status).toBe("RESOLVING");
    expect(midState?.proofs[0].httpStatus).toBe(500);
    expect(midState?.proofs[0].value).toBeNull();

    // 2) Resolve_after + 25h: transitions to VOID / INVALID
    const voidTick = await runOracleTick(db, {
      now: new Date(failingMkt.resolveAfter.getTime() + 25 * 3_600_000),
      oracleSecretKey: oracleSk,
      broadcastFn: async () => [],
      fetchFn: errorFetch,
    });
    expect(voidTick.voided_track_a).toContain(failingMkt.id);
    const endState = await getMarketProofBundleFromDb(db, failingMkt.id);
    expect(endState?.market.status).toBe("VOID");
    expect(endState?.market.outcome).toBe("INVALID");
  });
});
