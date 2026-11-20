import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getPublicKey } from "nostr-tools/pure";
import { getOrGenerateEvidenceSummary } from "@/lib/ai/evidence";
import { validateFullMarketSpec } from "@/lib/ai/validate-spec";
import * as schema from "@/lib/db/schema";
import type { FetchLike, Side } from "@/lib/domain/constants";
import type { MarketSpec } from "@/lib/domain/market-spec";
import { computeSpecSha256 } from "@/lib/domain/spec-hash";
import {
  buildMarketAnnouncementEvent,
  buildMarketSpecEvent,
} from "@/lib/nostr/events";
import {
  getPlatformKeypair,
  getPlatformOracleKeypair,
} from "@/lib/nostr/keys";
import { resolveTrackAMarket } from "@/lib/oracle/worker-repo";
import { placeBetOrder, settleBetByPaymentHash } from "@/lib/payments/bet-repo";

export const DEMO_MARKET_SLUGS = [
  "demo-btc-5m-binance",
  "demo-dc-temp-openmeteo",
  "demo-senegal-afcon-nostr",
  "demo-eur-usd-frankfurter",
  "demo-bitcoin-github-stars",
  "demo-us-digital-assets-bill",
] as const;

export interface SeedDemoResult {
  created_markets: number;
  skipped_markets: number;
  created_users: number;
  market_slugs: string[];
}

function deriveDemoKeypair(label: string): { secretKey: Uint8Array; pubkey: string } {
  const secretKey = new Uint8Array(
    createHash("sha256").update(`bitpredict-demo:${label}:v1`).digest(),
  );
  const pubkey = getPublicKey(secretKey);
  return { secretKey, pubkey };
}

function simInvoiceFactory(opts: { amountSats: number }) {
  const paymentHash = createHash("sha256")
    .update(`demo-inv:${opts.amountSats}:${crypto.randomUUID()}`)
    .digest("hex");
  return Promise.resolve({
    paymentHash,
    bolt11: `lnbcsim${opts.amountSats}0n1p${paymentHash.slice(0, 24)}`,
    simulated: true,
  });
}

function simVerifyFactory(paymentHash: string) {
  return Promise.resolve({
    paid: true,
    preimage: createHash("sha256").update(`demo-pre:${paymentHash}`).digest("hex"),
  });
}

function simRequestLnurlInvoice(address: string, amountMsat: number) {
  const h = createHash("sha256")
    .update(`demo-lnurl:${address}:${amountMsat}:${crypto.randomUUID()}`)
    .digest("hex");
  return Promise.resolve({
    ok: true as const,
    bolt11: `lnbcsim${Math.floor(amountMsat / 1000)}0n1p${h.slice(0, 24)}`,
    simulated: true,
  });
}

function simPayLightningInvoice(bolt11: string) {
  const paymentHash = createHash("sha256").update(`pay:${bolt11}`).digest("hex");
  const preimage = createHash("sha256").update(`pre:${bolt11}`).digest("hex");
  return Promise.resolve({
    ok: true as const,
    paymentHash,
    preimage,
    simulated: true,
  });
}

async function seedSingleBet(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    marketId: string;
    userPubkey: string;
    side: Side;
    amountSats: number;
    now: Date;
  },
) {
  const placed = await placeBetOrder(db, {
    marketIdOrSlug: opts.marketId,
    userPubkey: opts.userPubkey,
    side: opts.side,
    amountSats: opts.amountSats,
    now: opts.now,
    createInvoiceFn: (args) => simInvoiceFactory(args),
  });
  if (!placed.ok) {
    throw new Error(`Demo bet placement failed on ${opts.marketId}: ${placed.message}`);
  }
  const settled = await settleBetByPaymentHash(db, {
    paymentHash: placed.payment_hash,
    now: new Date(opts.now.getTime() + 5_000),
    verifyPaymentFn: (h) => simVerifyFactory(h),
  });
  if (!settled.ok) {
    throw new Error(`Demo bet settlement failed on ${opts.marketId}: ${settled.message}`);
  }
}

function resolveDemoPlatformKeypair(): { secretKey: Uint8Array; pubkey: string } {
  if (process.env.PLATFORM_NOSTR_SECRET_KEY?.trim() || process.env.NODE_ENV !== "production") {
    const kp = getPlatformKeypair();
    return { secretKey: kp.secretKey, pubkey: kp.pubkey };
  }
  return deriveDemoKeypair("platform-nostr");
}

function resolveDemoOracleKeypair(): { secretKey: Uint8Array; pubkey: string } {
  if (process.env.PLATFORM_ORACLE_SECRET_KEY?.trim() || process.env.NODE_ENV !== "production") {
    const kp = getPlatformOracleKeypair();
    return { secretKey: kp.secretKey, pubkey: kp.pubkey };
  }
  return deriveDemoKeypair("platform-oracle");
}

async function insertShowcaseMarket(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    slug: string;
    creatorPubkey: string;
    spec: MarketSpec;
    createdAt: Date;
    skipFutureTimeRule?: boolean;
  },
): Promise<schema.Market> {
  const { spec } = opts;
  if (!opts.skipFutureTimeRule) {
    const check = validateFullMarketSpec(spec, { now: opts.createdAt, minOpenMs: 60_000 });
    if (!check.ok) {
      throw new Error(`Invalid demo spec (${opts.slug}): ${check.errors.join("; ")}`);
    }
  }

  const specSha256 = computeSpecSha256(spec);
  const marketId = crypto.randomUUID();
  const bettingCutoff = new Date(spec.betting_cutoff_utc);
  const deadlineUtc = new Date(spec.deadline_utc);
  const resolveAfter = new Date(spec.resolve_after_utc);

  const platform = resolveDemoPlatformKeypair();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

  const specEvent = buildMarketSpecEvent({
    slug: opts.slug,
    spec,
    specSha256,
    creatorPubkey: opts.creatorPubkey,
    secretKey: platform.secretKey,
  });

  const noteEvent = buildMarketAnnouncementEvent({
    slug: opts.slug,
    spec,
    platformPubkey: platform.pubkey,
    appUrl,
    secretKey: platform.secretKey,
  });

  const [market] = await db
    .insert(schema.markets)
    .values({
      id: marketId,
      slug: opts.slug,
      creatorPubkey: opts.creatorPubkey,
      status: "OPEN",
      category: spec.category,
      track: spec.resolution_track,
      title: spec.title,
      spec,
      specSha256,
      bettingCutoff,
      deadlineUtc,
      resolveAfter,
      poolYesMsat: 0,
      poolNoMsat: 0,
      feeBps: 200,
      nostrNoteId: noteEvent.id,
      isDemo: true,
      createdAt: opts.createdAt,
    })
    .returning();

  await db
    .insert(schema.nostrEvents)
    .values([
      {
        id: specEvent.id,
        marketId: market.id,
        kind: specEvent.kind,
        event: specEvent,
        relaysOk: [],
        createdAt: opts.createdAt,
      },
      {
        id: noteEvent.id,
        marketId: market.id,
        kind: noteEvent.kind,
        event: noteEvent,
        relaysOk: [],
        createdAt: opts.createdAt,
      },
    ])
    .onConflictDoNothing();

  return market;
}

export async function seedDemoWorkspace(
  db: LibSQLDatabase<typeof schema>,
  opts: { now?: Date } = {},
): Promise<SeedDemoResult> {
  const now = opts.now ?? new Date();

  const alice = deriveDemoKeypair("alice");
  const bob = deriveDemoKeypair("bob");
  const signer = deriveDemoKeypair("signer");

  const demoUsers = [
    { pubkey: alice.pubkey, lightningAddress: "alice@getalby.com", isGuest: true },
    { pubkey: bob.pubkey, lightningAddress: "bob@getalby.com", isGuest: true },
    { pubkey: signer.pubkey, lightningAddress: "signer@getalby.com", isGuest: true },
  ];

  let createdUsers = 0;
  for (const u of demoUsers) {
    const inserted = await db
      .insert(schema.users)
      .values(u)
      .onConflictDoNothing({ target: schema.users.pubkey })
      .returning();
    if (inserted.length > 0) createdUsers += 1;
  }

  await db
    .update(schema.users)
    .set({ isGuest: true })
    .where(inArray(schema.users.pubkey, demoUsers.map((u) => u.pubkey)));

  await db
    .update(schema.markets)
    .set({ isDemo: true })
    .where(and(inArray(schema.markets.slug, [...DEMO_MARKET_SLUGS]), eq(schema.markets.isDemo, false)));

  await db
    .insert(schema.signers)
    .values({
      pubkey: signer.pubkey,
      policy: "platform_signer",
      active: true,
    })
    .onConflictDoNothing({ target: schema.signers.pubkey });

  const existingRows = await db
    .select({ slug: schema.markets.slug })
    .from(schema.markets)
    .where(inArray(schema.markets.slug, [...DEMO_MARKET_SLUGS]));
  const existingSet = new Set(existingRows.map((r) => r.slug));

  let createdMarkets = 0;
  let skippedMarkets = 0;

  const iso = (msOffset: number) => new Date(now.getTime() + msOffset).toISOString();
  const ymd = (msOffset: number) => new Date(now.getTime() + msOffset).toISOString().slice(0, 10);

  // 1. Crypto — OPEN short-horizon Binance BTC price market
  if (!existingSet.has("demo-btc-5m-binance")) {
    const deadlineMs = now.getTime() + 6 * 3_600_000;
    const spec: MarketSpec = {
      title: "BTC/USDT >= $100,000 (Today Close)",
      question: "Will BTC/USDT spot close at or above $100,000 on Binance?",
      category: "Crypto",
      resolution_track: "auto_api",
      rules: `Resolves YES if Binance BTCUSDT 1-minute candle close at ${new Date(deadlineMs).toISOString()} is >= 100000. Resolves NO otherwise.`,
      betting_cutoff_utc: new Date(now.getTime() + 5 * 3_600_000).toISOString(),
      deadline_utc: new Date(deadlineMs).toISOString(),
      resolve_after_utc: new Date(deadlineMs + 60_000).toISOString(),
      invalid_conditions: ["Binance API unavailable 24h after resolve_after_utc"],
      oracle_config: {
        provider: "binance",
        params: { symbol: "BTCUSDT", interval: "1m", startTime: deadlineMs, limit: 1 },
        value_path: "[0][4]",
        condition: { operator: ">=", threshold: 100000 },
      },
      assumptions: ["Price referenced to Binance spot BTC/USDT 1m kline close"],
      ai_confidence: 0.93,
    };
    const mkt = await insertShowcaseMarket(db, {
      slug: "demo-btc-5m-binance",
      creatorPubkey: alice.pubkey,
      spec,
      createdAt: new Date(now.getTime() - 1_800_000),
    });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: alice.pubkey, side: "YES", amountSats: 12_000, now });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: bob.pubkey, side: "NO", amountSats: 8_000, now });
    createdMarkets += 1;
  } else {
    skippedMarkets += 1;
  }

  // 2. Weather — SETTLED Open-Meteo Washington D.C. market with proof, Kind 30079, and SENT payout
  if (!existingSet.has("demo-dc-temp-openmeteo")) {
    const yesterdayYmd = ymd(-24 * 3_600_000);
    const pastBetTime = new Date(now.getTime() - 50 * 3_600_000);
    const spec: MarketSpec = {
      title: `Washington, D.C. Max Temp > 20°C (${yesterdayYmd})`,
      question: `Did Washington, D.C. daily max temperature exceed 20°C on ${yesterdayYmd}?`,
      category: "Weather",
      resolution_track: "auto_api",
      rules: `Resolves YES if Open-Meteo daily temperature_2m_max for Washington, D.C. on ${yesterdayYmd} is > 20. Resolves NO otherwise.`,
      betting_cutoff_utc: iso(-48 * 3_600_000),
      deadline_utc: iso(-36 * 3_600_000),
      resolve_after_utc: iso(-24 * 3_600_000),
      invalid_conditions: ["Open-Meteo data unavailable 24h after resolve_after_utc"],
      oracle_config: {
        provider: "open-meteo",
        params: {
          latitude: 38.9072,
          longitude: -77.0369,
          daily: "temperature_2m_max",
          timezone: "America/New_York",
          start_date: yesterdayYmd,
          end_date: yesterdayYmd,
        },
        value_path: "daily.temperature_2m_max[0]",
        condition: { operator: ">", threshold: 20 },
      },
      assumptions: ["Location matched to Washington, D.C., USA", "Day boundaries use America/New_York"],
      ai_confidence: 0.94,
    };
    const mkt = await insertShowcaseMarket(db, {
      slug: "demo-dc-temp-openmeteo",
      creatorPubkey: bob.pubkey,
      spec,
      createdAt: new Date(now.getTime() - 72 * 3_600_000),
      skipFutureTimeRule: true,
    });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: alice.pubkey, side: "YES", amountSats: 15_000, now: pastBetTime });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: bob.pubkey, side: "NO", amountSats: 10_000, now: pastBetTime });

    const weatherFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          latitude: 38.9072,
          longitude: -77.0369,
          daily: {
            time: [yesterdayYmd],
            temperature_2m_max: [24.6],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const demoPlatform = resolveDemoPlatformKeypair();
    const demoOracle = resolveDemoOracleKeypair();
    await resolveTrackAMarket(db, mkt.id, {
      now,
      forceResolveNow: true,
      fetchFn: weatherFetch,
      broadcastFn: async () => [],
      oracleSecretKey: demoOracle.secretKey,
      platformSecretKey: demoPlatform.secretKey,
      platformPubkey: demoPlatform.pubkey,
      requestInvoiceFn: (addr, msat) => simRequestLnurlInvoice(addr, msat),
      payInvoiceFn: (bolt11) => simPayLightningInvoice(bolt11),
    });
    createdMarkets += 1;
  } else {
    skippedMarkets += 1;
  }

  // 3. Sports — PENDING_RESOLUTION Track B Senegal AFCON market ready for signer queue demo
  if (!existingSet.has("demo-senegal-afcon-nostr")) {
    const pastBetTime = new Date(now.getTime() - 10 * 3_600_000);
    const spec: MarketSpec = {
      title: "Senegal National Team wins AFCON qualifier",
      question: "Did Senegal win their scheduled AFCON qualifier match?",
      category: "Sports",
      resolution_track: "nostr_oracle",
      rules: "Resolves YES if official CAF / BBC Sport match report confirms a Senegal victory in regulation/penalties. Resolves NO otherwise.",
      betting_cutoff_utc: iso(-6 * 3_600_000),
      deadline_utc: iso(-4 * 3_600_000),
      resolve_after_utc: iso(-2 * 3_600_000),
      invalid_conditions: ["Match postponed or abandoned"],
      oracle_config: {
        signer_policy: "platform_signer",
        suggested_sources: [
          "Official CAF match report",
          "BBC Sport / ESPN football box score",
        ],
      },
      assumptions: ["Category 'Sports' routed to Nostr community oracle with challenge window"],
      ai_confidence: 0.89,
    };
    const mkt = await insertShowcaseMarket(db, {
      slug: "demo-senegal-afcon-nostr",
      creatorPubkey: alice.pubkey,
      spec,
      createdAt: new Date(now.getTime() - 48 * 3_600_000),
      skipFutureTimeRule: true,
    });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: alice.pubkey, side: "YES", amountSats: 20_000, now: pastBetTime });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: bob.pubkey, side: "NO", amountSats: 12_000, now: pastBetTime });
    await db
      .update(schema.markets)
      .set({ status: "PENDING_RESOLUTION" })
      .where(eq(schema.markets.id, mkt.id));
    await getOrGenerateEvidenceSummary(db, mkt.id, { apiKey: "" });
    createdMarkets += 1;
  } else {
    skippedMarkets += 1;
  }

  // 4. Finance — OPEN Frankfurter EUR/USD FX market
  if (!existingSet.has("demo-eur-usd-frankfurter")) {
    const targetYmd = ymd(5 * 24 * 3_600_000);
    const spec: MarketSpec = {
      title: `EUR/USD >= 1.05 (${targetYmd})`,
      question: `Will ECB EUR/USD reference rate close at or above 1.05 on ${targetYmd}?`,
      category: "Finance",
      resolution_track: "auto_api",
      rules: `Resolves YES if Frankfurter ECB reference rate EUR->USD on ${targetYmd} is >= 1.05. Resolves NO otherwise.`,
      betting_cutoff_utc: iso(4 * 24 * 3_600_000),
      deadline_utc: iso(5 * 24 * 3_600_000),
      resolve_after_utc: iso(5 * 24 * 3_600_000 + 3_600_000),
      invalid_conditions: ["ECB reference rate unavailable after 24h fallback"],
      oracle_config: {
        provider: "frankfurter",
        params: { date: targetYmd, from: "EUR", to: "USD" },
        value_path: "rates.USD",
        condition: { operator: ">=", threshold: 1.05 },
      },
      assumptions: ["FX rate EUR/USD sourced from ECB via Frankfurter API"],
      ai_confidence: 0.9,
    };
    const mkt = await insertShowcaseMarket(db, {
      slug: "demo-eur-usd-frankfurter",
      creatorPubkey: alice.pubkey,
      spec,
      createdAt: new Date(now.getTime() - 3_600_000),
    });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: alice.pubkey, side: "YES", amountSats: 5_000, now });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: bob.pubkey, side: "NO", amountSats: 5_000, now });
    createdMarkets += 1;
  } else {
    skippedMarkets += 1;
  }

  // 5. Technology — OPEN GitHub bitcoin/bitcoin stars milestone market
  if (!existingSet.has("demo-bitcoin-github-stars")) {
    const spec: MarketSpec = {
      title: "bitcoin/bitcoin GitHub stars >= 85,000",
      question: "Will the bitcoin/bitcoin repository reach 85,000 GitHub stars by deadline?",
      category: "Technology",
      resolution_track: "auto_api",
      rules: "Resolves YES if GitHub repository bitcoin/bitcoin stargazers_count at deadline is >= 85000. Resolves NO otherwise.",
      betting_cutoff_utc: iso(13 * 24 * 3_600_000),
      deadline_utc: iso(14 * 24 * 3_600_000),
      resolve_after_utc: iso(14 * 24 * 3_600_000),
      invalid_conditions: ["Repository deleted or made private"],
      oracle_config: {
        provider: "github",
        params: { owner: "bitcoin", repo: "bitcoin" },
        value_path: "stargazers_count",
        condition: { operator: ">=", threshold: 85000 },
      },
      assumptions: ["GitHub repository resolved as bitcoin/bitcoin (stargazers_count)"],
      ai_confidence: 0.91,
    };
    const mkt = await insertShowcaseMarket(db, {
      slug: "demo-bitcoin-github-stars",
      creatorPubkey: bob.pubkey,
      spec,
      createdAt: new Date(now.getTime() - 5_400_000),
    });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: bob.pubkey, side: "YES", amountSats: 9_000, now });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: alice.pubkey, side: "NO", amountSats: 6_000, now });
    createdMarkets += 1;
  } else {
    skippedMarkets += 1;
  }

  // 6. Politics — OPEN Track B U.S. digital assets bill market
  if (!existingSet.has("demo-us-digital-assets-bill")) {
    const spec: MarketSpec = {
      title: "U.S. digital assets market-structure bill enacted",
      question: "Will a federal U.S. digital assets market-structure bill pass Congress this quarter?",
      category: "Politics",
      resolution_track: "nostr_oracle",
      rules: "Resolves YES if official Congress.gov legislative records confirm House and Senate passage before deadline. Resolves NO otherwise.",
      betting_cutoff_utc: iso(29 * 24 * 3_600_000),
      deadline_utc: iso(30 * 24 * 3_600_000),
      resolve_after_utc: iso(30 * 24 * 3_600_000 + 3_600_000),
      invalid_conditions: ["Congressional session adjourned indefinitely"],
      oracle_config: {
        signer_policy: "platform_signer",
        suggested_sources: [
          "Congress.gov official legislative record",
          "Associated Press / Reuters",
        ],
      },
      assumptions: ["Category 'Politics' routed to Nostr community oracle with challenge window"],
      ai_confidence: 0.85,
    };
    const mkt = await insertShowcaseMarket(db, {
      slug: "demo-us-digital-assets-bill",
      creatorPubkey: alice.pubkey,
      spec,
      createdAt: new Date(now.getTime() - 7_200_000),
    });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: alice.pubkey, side: "YES", amountSats: 7_000, now });
    await seedSingleBet(db, { marketId: mkt.id, userPubkey: bob.pubkey, side: "NO", amountSats: 13_000, now });
    createdMarkets += 1;
  } else {
    skippedMarkets += 1;
  }

  return {
    created_markets: createdMarkets,
    skipped_markets: skippedMarkets,
    created_users: createdUsers,
    market_slugs: [...DEMO_MARKET_SLUGS],
  };
}
