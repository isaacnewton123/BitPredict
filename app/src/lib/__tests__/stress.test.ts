import { createClient, type Client } from "@libsql/client";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { applyTestMigrations } from "@/lib/db/test-migrations";
import { getCategory } from "@/lib/domain/categories";
import { CATEGORIES, RESOLUTION_TRACKS, type Category, type ResolutionTrack } from "@/lib/domain/constants";
import { MarketSpecSchema, type MarketSpec } from "@/lib/domain/market-spec";
import { formatSats, impliedYesProbability } from "@/lib/domain/pool";
import { checkTimeRules } from "@/lib/domain/time-rules";

async function createMigratedMemoryDb(): Promise<{ client: Client; db: LibSQLDatabase<typeof schema> }> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON;");
  await applyTestMigrations(client);
  return { client, db: drizzle(client, { schema }) };
}

function makeBaseAutoApiSpec(category: Category = "Weather"): MarketSpec {
  return {
    title: "Washington, D.C. max temperature >= 19°C on Nov 20, 2026",
    question: "Will the daily maximum temperature in Washington, D.C. reach 19.0°C on Nov 20, 2026?",
    category,
    resolution_track: "auto_api",
    rules: "Resolves YES if Open-Meteo daily temperature_2m_max >= 19.0, NO otherwise.",
    betting_cutoff_utc: "2026-11-20T05:00:00Z",
    deadline_utc: "2026-11-21T04:59:59Z",
    resolve_after_utc: "2026-11-21T07:00:00Z",
    invalid_conditions: [],
    oracle_config: {
      provider: "open-meteo",
      params: {
        latitude: 38.9072,
        longitude: -77.0369,
        daily: "temperature_2m_max",
        timezone: "America/New_York",
        start_date: "2026-11-20",
        end_date: "2026-11-20",
      },
      value_path: "daily.temperature_2m_max[0]",
      condition: { operator: ">=", threshold: 19.0 },
    },
    assumptions: ["'Washington' interpreted as Washington, D.C., USA"],
    ai_confidence: 0.93,
  };
}

function makeBaseNostrOracleSpec(category: Category = "Politics"): MarketSpec {
  return {
    title: "Will policy bill pass before Dec 31, 2026?",
    question: "Will the proposed policy bill receive final legislative passage before Dec 31, 2026?",
    category,
    resolution_track: "nostr_oracle",
    rules: "Resolves YES if official legislative record shows final passage before deadline.",
    betting_cutoff_utc: "2026-12-30T23:59:59Z",
    deadline_utc: "2026-12-31T23:59:59Z",
    resolve_after_utc: "2027-01-01T01:00:00Z",
    invalid_conditions: [],
    oracle_config: {
      signer_policy: "platform_signer",
      suggested_sources: ["Official gazette"],
    },
    assumptions: ["UTC end-of-day"],
  };
}

// -----------------------------------------------------------------------------
// 1. Adversarial & Boundary Domain Validation ("Street" Cases)
// -----------------------------------------------------------------------------
describe("Domain street & adversarial validation", () => {
  it("enforces all 18 category x resolution_track combinations (9 categories x 2 tracks)", () => {
    let checked = 0;
    for (const category of CATEGORIES) {
      for (const track of RESOLUTION_TRACKS) {
        const candidate =
          track === "auto_api"
            ? makeBaseAutoApiSpec(category)
            : makeBaseNostrOracleSpec(category);
        const expected = getCategory(category).allowedTracks.includes(track);
        const result = MarketSpecSchema.safeParse(candidate);
        expect(result.success, `category=${category} track=${track}`).toBe(expected);
        checked++;
      }
    }
    expect(checked).toBe(18);
  });

  it("blocks SSRF scheme variants in oracle_config.params while allowing safe parameter values", () => {
    const evilUrls = [
      "http://169.254.169.254/latest/meta-data",
      "https://evil.example/api",
      "ftp://files.example/payload",
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_INFO",
      "ws://localhost:8080",
      "wss://socket.example",
      "HTTPS://EVIL.EXAMPLE/UPPER",
      "  https://leading-whitespace.example",
      "custom+scheme://weird-handler",
    ];

    for (const url of evilUrls) {
      const base = makeBaseAutoApiSpec("Weather");
      const bad = {
        ...base,
        oracle_config: {
          ...base.oracle_config,
          params: {
            ...(base.oracle_config as Extract<MarketSpec["oracle_config"], { provider: string }>).params,
            injected: url,
          },
        },
      };
      expect(MarketSpecSchema.safeParse(bad).success, `expected rejection for ${url}`).toBe(false);
    }

    // Legitimate slash-containing values (e.g. IANA timezone) must still pass.
    expect(MarketSpecSchema.safeParse(makeBaseAutoApiSpec("Weather")).success).toBe(true);
  });

  it("rejects malicious or invalid value_path expressions", () => {
    const badPaths = [
      "../secret",
      "daily; DROP TABLE markets",
      "daily['temperature']",
      'daily["temperature"]',
      "daily temperature",
      "",
      "a".repeat(121),
    ];

    for (const valuePath of badPaths) {
      const base = makeBaseAutoApiSpec("Weather");
      const bad = {
        ...base,
        oracle_config: {
          ...base.oracle_config,
          value_path: valuePath,
        },
      };
      expect(MarketSpecSchema.safeParse(bad).success, `expected rejection for value_path=${valuePath}`).toBe(false);
    }

    const goodPaths = ["daily.temperature_2m_max[0]", "[0][4]", "$", "rates.EUR"];
    for (const valuePath of goodPaths) {
      const base = makeBaseAutoApiSpec("Weather");
      const ok = {
        ...base,
        oracle_config: {
          ...base.oracle_config,
          value_path: valuePath,
        },
      };
      expect(MarketSpecSchema.safeParse(ok).success, `expected acceptance for value_path=${valuePath}`).toBe(true);
    }
  });

  it("handles boundary and extreme 21M BTC supply pool values accurately", () => {
    expect(impliedYesProbability(0, 0)).toBe(0.5);
    expect(impliedYesProbability(1, 0)).toBe(1);
    expect(impliedYesProbability(0, 1)).toBe(0);

    // Asymmetric whale vs 1 msat
    const whaleRatio = impliedYesProbability(1, 10_000_000_000_000);
    expect(whaleRatio).toBeGreaterThan(0);
    expect(whaleRatio).toBeLessThan(1e-12);

    // 21M BTC in millisatoshis = 2,100,000,000,000,000 sats = 2,100,000,000,000,000,000 msat
    const maxSupplyMsat = 2_100_000_000_000_000_000n;
    expect(impliedYesProbability(maxSupplyMsat, maxSupplyMsat)).toBe(0.5);

    const minVsMax = impliedYesProbability(1n, maxSupplyMsat);
    expect(Number.isFinite(minVsMax)).toBe(true);
    expect(minVsMax).toBeGreaterThan(0);
    expect(minVsMax).toBeLessThan(1e-15);

    expect(formatSats(0)).toBe("0");
    expect(formatSats(999)).toBe("0");
    expect(formatSats(1000)).toBe("1");
    expect(formatSats(maxSupplyMsat)).toBe("2,100,000,000,000,000");
  });

  it("validates 2,000 MarketSpec + time-rule payloads within 2,000 ms", () => {
    const spec = makeBaseAutoApiSpec("Weather");
    const now = new Date("2026-11-19T12:00:00Z");

    const start = performance.now();
    for (let i = 0; i < 2_000; i++) {
      const parsed = MarketSpecSchema.safeParse(spec);
      if (!parsed.success) throw new Error("Unexpected parse failure");
      const violations = checkTimeRules(parsed.data, { now });
      if (violations.length > 0) throw new Error("Unexpected time rule violation");
    }
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(2_000);
  });
});

// -----------------------------------------------------------------------------
// 2. Database Constraint & Integrity Torture Tests
// -----------------------------------------------------------------------------
describe("Database constraint & integrity torture tests", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  const userA = "a".repeat(64);
  const userB = "b".repeat(64);
  const baseMarketId = "00000000-0000-4000-8000-000000000001";
  const baseSpec = makeBaseAutoApiSpec("Weather");

  const tCutoff = new Date("2026-11-20T05:00:00Z");
  const tDeadline = new Date("2026-11-21T04:59:59Z");
  const tResolve = new Date("2026-11-21T07:00:00Z");

  beforeAll(async () => {
    ({ client, db } = await createMigratedMemoryDb());
    await db.insert(schema.users).values([
      { pubkey: userA, lightningAddress: "alice@getalby.com", isGuest: false },
      { pubkey: userB, lightningAddress: "bob@getalby.com", isGuest: false },
    ]);
    await db.insert(schema.markets).values({
      id: baseMarketId,
      slug: "base-weather-market",
      creatorPubkey: userA,
      status: "OPEN",
      category: "Weather",
      track: "auto_api",
      title: baseSpec.title,
      spec: baseSpec,
      specSha256: "deadbeef".repeat(8),
      bettingCutoff: tCutoff,
      deadlineUtc: tDeadline,
      resolveAfter: tResolve,
    });
  });

  afterAll(() => {
    client.close();
  });

  it("enforces markets_time_order CHECK constraint (cutoff <= deadline <= resolveAfter)", async () => {
    // cutoff > deadline
    await expect(
      db.insert(schema.markets).values({
        slug: "bad-time-order-1",
        creatorPubkey: userA,
        status: "OPEN",
        category: "Weather",
        track: "auto_api",
        title: "Invalid time market 1",
        spec: baseSpec,
        specSha256: "0".repeat(64),
        bettingCutoff: new Date("2026-11-22T00:00:00Z"),
        deadlineUtc: tDeadline,
        resolveAfter: tResolve,
      }),
    ).rejects.toThrow();

    // deadline > resolveAfter
    await expect(
      db.insert(schema.markets).values({
        slug: "bad-time-order-2",
        creatorPubkey: userA,
        status: "OPEN",
        category: "Weather",
        track: "auto_api",
        title: "Invalid time market 2",
        spec: baseSpec,
        specSha256: "0".repeat(64),
        bettingCutoff: tCutoff,
        deadlineUtc: new Date("2026-11-22T00:00:00Z"),
        resolveAfter: tResolve,
      }),
    ).rejects.toThrow();
  });

  it("enforces markets_slug_unique constraint", async () => {
    await expect(
      db.insert(schema.markets).values({
        slug: "base-weather-market",
        creatorPubkey: userA,
        status: "OPEN",
        category: "Weather",
        track: "auto_api",
        title: "Duplicate slug market",
        spec: baseSpec,
        specSha256: "1".repeat(64),
        bettingCutoff: tCutoff,
        deadlineUtc: tDeadline,
        resolveAfter: tResolve,
      }),
    ).rejects.toThrow();
  });

  it("enforces bets_amount_pos CHECK constraint (rejects 0 and negative amounts)", async () => {
    await expect(
      db.insert(schema.bets).values({
        marketId: baseMarketId,
        userPubkey: userA,
        side: "YES",
        amountMsat: 0,
        paymentHash: "hash-zero-amount",
        bolt11: "lnbc0n1...",
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.bets).values({
        marketId: baseMarketId,
        userPubkey: userA,
        side: "NO",
        amountMsat: -1_000,
        paymentHash: "hash-neg-amount",
        bolt11: "lnbc1n1...",
      }),
    ).rejects.toThrow();
  });

  it("enforces bets_payment_hash_unique against webhook replay / duplicate payment hashes", async () => {
    await db.insert(schema.bets).values({
      marketId: baseMarketId,
      userPubkey: userA,
      side: "YES",
      amountMsat: 100_000,
      paymentHash: "unique-payment-hash-001",
      bolt11: "lnbc100n1...",
      status: "CONFIRMED",
      paidAt: new Date(),
    });

    await expect(
      db.insert(schema.bets).values({
        marketId: baseMarketId,
        userPubkey: userB,
        side: "NO",
        amountMsat: 100_000,
        paymentHash: "unique-payment-hash-001",
        bolt11: "lnbc100n1...",
      }),
    ).rejects.toThrow();
  });

  it("enforces payouts_market_user_kind_uq against double payouts", async () => {
    await db.insert(schema.payouts).values({
      marketId: baseMarketId,
      userPubkey: userA,
      kind: "WIN",
      amountMsat: 190_000,
      status: "QUEUED",
    });

    // Duplicate (marketId, userPubkey, kind) must fail
    await expect(
      db.insert(schema.payouts).values({
        marketId: baseMarketId,
        userPubkey: userA,
        kind: "WIN",
        amountMsat: 190_000,
        status: "QUEUED",
      }),
    ).rejects.toThrow();

    // Different kind on same market+user must succeed
    await expect(
      db.insert(schema.payouts).values({
        marketId: baseMarketId,
        userPubkey: userA,
        kind: "BOND_RETURN",
        amountMsat: 50_000,
        status: "QUEUED",
      }),
    ).resolves.toBeDefined();
  });

  it("enforces foreign keys (rejects orphan markets and orphan bets)", async () => {
    const missingUser = "f".repeat(64);
    const missingMarket = "00000000-0000-4000-8000-999999999999";

    await expect(
      db.insert(schema.markets).values({
        slug: "orphan-creator-market",
        creatorPubkey: missingUser,
        status: "OPEN",
        category: "Weather",
        track: "auto_api",
        title: "Orphan market",
        spec: baseSpec,
        specSha256: "2".repeat(64),
        bettingCutoff: tCutoff,
        deadlineUtc: tDeadline,
        resolveAfter: tResolve,
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.bets).values({
        marketId: missingMarket,
        userPubkey: userA,
        side: "YES",
        amountMsat: 50_000,
        paymentHash: "orphan-bet-market",
        bolt11: "lnbc50n1...",
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.bets).values({
        marketId: baseMarketId,
        userPubkey: missingUser,
        side: "YES",
        amountMsat: 50_000,
        paymentHash: "orphan-bet-user",
        bolt11: "lnbc50n1...",
      }),
    ).rejects.toThrow();
  });
});

// -----------------------------------------------------------------------------
// 3. High-Volume Bulk Load & Pool/Ledger Reconciliation Stress Test
// -----------------------------------------------------------------------------
describe("High-volume bulk load & pool/ledger reconciliation", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  beforeAll(async () => {
    ({ client, db } = await createMigratedMemoryDb());
  });

  afterAll(() => {
    client.close();
  });

  it("inserts 50 users, 100 markets, 1,000 bets + double-entry ledger rows and reconciles exactly", async () => {
    const USER_COUNT = 50;
    const MARKET_COUNT = 100;
    const BETS_PER_MARKET = 10; // 1,000 bets total

    const userRows = Array.from({ length: USER_COUNT }, (_, i) => ({
      pubkey: `bulk-user-${i.toString().padStart(4, "0")}${"0".repeat(50)}`.slice(0, 64),
      lightningAddress: `user${i}@bitpredict.test`,
      isGuest: i % 5 === 0,
    }));
    await db.insert(schema.users).values(userRows);

    const tCutoff = new Date("2026-12-01T00:00:00Z");
    const tDeadline = new Date("2026-12-02T00:00:00Z");
    const tResolve = new Date("2026-12-02T02:00:00Z");

    const marketIds: string[] = [];
    const expectedYesByMarket = new Map<string, number>();
    const expectedNoByMarket = new Map<string, number>();

    const marketRows = Array.from({ length: MARKET_COUNT }, (_, mIdx) => {
      const category = CATEGORIES[mIdx % CATEGORIES.length];
      const track: ResolutionTrack = getCategory(category).defaultTrack;
      const spec = track === "auto_api" ? makeBaseAutoApiSpec(category) : makeBaseNostrOracleSpec(category);
      const id = `00000000-0000-4000-9000-${mIdx.toString().padStart(12, "0")}`;
      marketIds.push(id);
      expectedYesByMarket.set(id, 0);
      expectedNoByMarket.set(id, 0);

      return {
        id,
        slug: `bulk-market-${mIdx}`,
        creatorPubkey: userRows[mIdx % USER_COUNT].pubkey,
        status: mIdx % 10 === 0 ? ("CLOSED" as const) : ("OPEN" as const),
        category,
        track,
        title: `Bulk Market #${mIdx} (${category})`,
        spec,
        specSha256: mIdx.toString(16).padStart(64, "0"),
        bettingCutoff: tCutoff,
        deadlineUtc: tDeadline,
        resolveAfter: tResolve,
        poolYesMsat: 0,
        poolNoMsat: 0,
      };
    });
    await db.insert(schema.markets).values(marketRows);

    const betRows: (typeof schema.bets.$inferInsert)[] = [];
    const ledgerRows: (typeof schema.ledgerEntries.$inferInsert)[] = [];
    let totalConfirmedMsat = 0;

    for (let mIdx = 0; mIdx < MARKET_COUNT; mIdx++) {
      const marketId = marketIds[mIdx];
      for (let b = 0; b < BETS_PER_MARKET; b++) {
        const globalIdx = mIdx * BETS_PER_MARKET + b;
        const betId = `10000000-0000-4000-9000-${globalIdx.toString().padStart(12, "0")}`;
        const side = globalIdx % 2 === 0 ? ("YES" as const) : ("NO" as const);
        const isConfirmed = globalIdx % 5 !== 4; // 80% CONFIRMED, 20% PENDING
        const amountMsat = ((globalIdx % 25) + 1) * 10_000; // 10..250 sats in msat

        betRows.push({
          id: betId,
          marketId,
          userPubkey: userRows[globalIdx % USER_COUNT].pubkey,
          side,
          amountMsat,
          paymentHash: `bulk-hash-${globalIdx.toString().padStart(6, "0")}`,
          bolt11: `lnbc${amountMsat}p1bulk`,
          status: isConfirmed ? "CONFIRMED" : "PENDING",
          paidAt: isConfirmed ? new Date() : null,
        });

        if (isConfirmed) {
          totalConfirmedMsat += amountMsat;
          if (side === "YES") {
            expectedYesByMarket.set(marketId, (expectedYesByMarket.get(marketId) ?? 0) + amountMsat);
          } else {
            expectedNoByMarket.set(marketId, (expectedNoByMarket.get(marketId) ?? 0) + amountMsat);
          }
          // Double-entry: credit escrow, debit market pool account
          ledgerRows.push(
            { account: "escrow", amountMsat, refType: "bet", refId: betId },
            { account: `market:${marketId}`, amountMsat: -amountMsat, refType: "bet", refId: betId },
          );
        }
      }
    }

    // Batch inserts in transaction + update market pools
    await db.transaction(async (tx) => {
      for (let i = 0; i < betRows.length; i += 200) {
        await tx.insert(schema.bets).values(betRows.slice(i, i + 200));
      }
      for (let i = 0; i < ledgerRows.length; i += 200) {
        await tx.insert(schema.ledgerEntries).values(ledgerRows.slice(i, i + 200));
      }
      for (const marketId of marketIds) {
        const yes = expectedYesByMarket.get(marketId) ?? 0;
        const no = expectedNoByMarket.get(marketId) ?? 0;
        await tx
          .update(schema.markets)
          .set({ poolYesMsat: yes, poolNoMsat: no })
          .where(eq(schema.markets.id, marketId));
      }
    });

    // Run concurrent queries across categories, statuses, and bet aggregations
    const [
      categoryResults,
      openCountRes,
      closedCountRes,
      aggregatedBets,
      allMarkets,
      ledgerSumRes,
      escrowSumRes,
    ] = await Promise.all([
      Promise.all(
        CATEGORIES.map((cat) =>
          db.select().from(schema.markets).where(and(eq(schema.markets.category, cat), eq(schema.markets.status, "OPEN"))),
        ),
      ),
      db.select({ count: sql<number>`count(*)` }).from(schema.markets).where(eq(schema.markets.status, "OPEN")),
      db.select({ count: sql<number>`count(*)` }).from(schema.markets).where(eq(schema.markets.status, "CLOSED")),
      db
        .select({
          marketId: schema.bets.marketId,
          yesSum: sql<number>`coalesce(sum(case when ${schema.bets.side} = 'YES' then ${schema.bets.amountMsat} else 0 end), 0)`,
          noSum: sql<number>`coalesce(sum(case when ${schema.bets.side} = 'NO' then ${schema.bets.amountMsat} else 0 end), 0)`,
        })
        .from(schema.bets)
        .where(eq(schema.bets.status, "CONFIRMED"))
        .groupBy(schema.bets.marketId),
      db.select().from(schema.markets),
      db.select({ net: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` }).from(schema.ledgerEntries),
      db
        .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.account, "escrow")),
    ]);

    expect(allMarkets).toHaveLength(MARKET_COUNT);
    expect(Number(openCountRes[0].count)).toBe(90);
    expect(Number(closedCountRes[0].count)).toBe(10);
    expect(categoryResults.reduce((acc, rows) => acc + rows.length, 0)).toBe(90);
    for (const rows of categoryResults) {
      expect(rows.length).toBeGreaterThan(0);
    }

    // Reconcile every market's pools against aggregated confirmed bets
    const aggMap = new Map(aggregatedBets.map((r) => [r.marketId, r]));
    for (const m of allMarkets) {
      const agg = aggMap.get(m.id);
      expect(m.poolYesMsat).toBe(Number(agg?.yesSum ?? 0));
      expect(m.poolNoMsat).toBe(Number(agg?.noSum ?? 0));
      expect(m.poolYesMsat).toBe(expectedYesByMarket.get(m.id));
      expect(m.poolNoMsat).toBe(expectedNoByMarket.get(m.id));
    }

    // Reconcile double-entry ledger net sum === 0 and escrow === totalConfirmedMsat
    expect(Number(ledgerSumRes[0].net)).toBe(0);
    expect(Number(escrowSumRes[0].total)).toBe(totalConfirmedMsat);
    expect(totalConfirmedMsat).toBeGreaterThan(0);
  });
});
