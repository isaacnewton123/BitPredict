import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileMarketPrompt } from "@/lib/ai/compiler";
import * as schema from "@/lib/db/schema";
import { estimatePotentialPayoutMsat, impliedYesProbability } from "@/lib/domain/pool";
import { createMarketDraft } from "@/lib/markets/draft-repo";
import { publishMarketDraft } from "@/lib/markets/publish-repo";
import {
  listUserPositionsFromDb,
  placeBetOrder,
  settleBetByPaymentHash,
} from "@/lib/payments/bet-repo";

const MIGRATION_PATH = path.resolve(process.cwd(), "drizzle/0000_mute_may_parker.sql");
const FIXED_NOW = new Date("2026-11-19T12:00:00Z");

describe("estimatePotentialPayoutMsat (fee on losing pool)", () => {
  it("never returns less than stake even when losing pool is tiny", () => {
    const res = estimatePotentialPayoutMsat({
      side: "YES",
      stakeMsat: 9_900_000,
      poolYesMsat: 0,
      poolNoMsat: 100_000,
      feeBps: 200,
    });
    expect(res.profitMsat).toBe(98_000);
    expect(res.payoutMsat).toBe(9_998_000);
    expect(res.payoutMsat).toBeGreaterThanOrEqual(9_900_000);
  });

  it("handles empty pools and proportional splits accurately", () => {
    const empty = estimatePotentialPayoutMsat({
      side: "YES",
      stakeMsat: 1_000_000,
      poolYesMsat: 0,
      poolNoMsat: 0,
    });
    expect(empty.payoutMsat).toBe(1_000_000);
    expect(empty.multiplier).toBe(1);

    const split = estimatePotentialPayoutMsat({
      side: "YES",
      stakeMsat: 1_000_000,
      poolYesMsat: 1_000_000,
      poolNoMsat: 2_000_000,
      feeBps: 200,
    });
    expect(split.profitMsat).toBe(980_000);
    expect(split.payoutMsat).toBe(1_980_000);
    expect(split.multiplier).toBeCloseTo(1.98, 5);
  });
});

describe("Lightning betting lifecycle (placeBetOrder & settleBetByPaymentHash)", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  const creatorPubkey = "1".repeat(64);
  const alicePubkey = "a".repeat(64);
  const bobPubkey = "b".repeat(64);

  let openMarketId: string;
  let bettingCutoff: Date;

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

    await db.insert(schema.users).values([
      { pubkey: creatorPubkey },
      { pubkey: alicePubkey, lightningAddress: "alice@getalby.com" },
      { pubkey: bobPubkey, lightningAddress: "bob@getalby.com" },
    ]);

    const compiled = await compileMarketPrompt({
      prompt: "Will the maximum temperature in Washington city reach 19°C tomorrow?",
      timezone: "America/New_York",
      now: FIXED_NOW,
      apiKey: "",
    });
    if (!compiled.ok) throw new Error("Failed to compile fixture market");

    const draft = await createMarketDraft(db, {
      creatorPubkey,
      prompt: "Will the maximum temperature in Washington city reach 19°C tomorrow?",
      timezone: "America/New_York",
      compiled,
    });
    const pub = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      now: FIXED_NOW,
      broadcastFn: async () => [],
    });
    if (!pub.ok) throw new Error("Failed to publish fixture market");

    openMarketId = pub.market.id;
    bettingCutoff = pub.market.bettingCutoff;
  });

  afterAll(() => {
    client.close();
  });

  it("rejects out-of-range stakes and bets past cutoff", async () => {
    for (const badAmount of [0, 5, 10.5, 100_001]) {
      const res = await placeBetOrder(db, {
        marketIdOrSlug: openMarketId,
        userPubkey: alicePubkey,
        side: "YES",
        amountSats: badAmount,
        now: FIXED_NOW,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(422);
        expect(res.code).toBe("BET_LIMIT");
      }
    }

    const closedRes = await placeBetOrder(db, {
      marketIdOrSlug: openMarketId,
      userPubkey: alicePubkey,
      side: "YES",
      amountSats: 100,
      now: new Date(bettingCutoff.getTime() + 1_000),
    });
    expect(closedRes.ok).toBe(false);
    if (!closedRes.ok) {
      expect(closedRes.status).toBe(409);
      expect(closedRes.code).toBe("MARKET_CLOSED");
    }
  });

  it("settles YES/NO bets from two wallets, updates implied probability, enforces idempotency and double-entry ledger", async () => {
    // 1) Alice places YES 3,000 sats
    const aliceOrder = await placeBetOrder(db, {
      marketIdOrSlug: openMarketId,
      userPubkey: alicePubkey,
      side: "YES",
      amountSats: 3_000,
      now: FIXED_NOW,
    });
    expect(aliceOrder.ok).toBe(true);
    if (!aliceOrder.ok) return;

    // 2) Reject unpaid invoice
    const unpaid = await settleBetByPaymentHash(db, {
      paymentHash: aliceOrder.payment_hash,
      now: FIXED_NOW,
      verifyPaymentFn: async () => ({ paid: false }),
    });
    expect(unpaid.ok).toBe(false);
    if (!unpaid.ok) expect(unpaid.status).toBe(402);

    // 3) Confirm Alice's bet
    const aliceSettle = await settleBetByPaymentHash(db, {
      paymentHash: aliceOrder.payment_hash,
      now: FIXED_NOW,
      verifyPaymentFn: async () => ({ paid: true, preimage: "a".repeat(64) }),
    });
    expect(aliceSettle.ok).toBe(true);
    if (!aliceSettle.ok) return;
    expect(aliceSettle.idempotent).toBe(false);
    expect(aliceSettle.bet.status).toBe("CONFIRMED");

    // 4) Idempotency check on duplicate webhook
    const dup1 = await settleBetByPaymentHash(db, {
      paymentHash: aliceOrder.payment_hash,
      now: FIXED_NOW,
      verifyPaymentFn: async () => ({ paid: true }),
    });
    const dup2 = await settleBetByPaymentHash(db, {
      paymentHash: aliceOrder.payment_hash,
      now: FIXED_NOW,
      verifyPaymentFn: async () => ({ paid: true }),
    });
    expect(dup1.ok && dup1.idempotent).toBe(true);
    expect(dup2.ok && dup2.idempotent).toBe(true);

    // 5) Bob places NO 1,000 sats and confirms
    const bobOrder = await placeBetOrder(db, {
      marketIdOrSlug: openMarketId,
      userPubkey: bobPubkey,
      side: "NO",
      amountSats: 1_000,
      now: FIXED_NOW,
    });
    expect(bobOrder.ok).toBe(true);
    if (!bobOrder.ok) return;

    const bobSettle = await settleBetByPaymentHash(db, {
      paymentHash: bobOrder.payment_hash,
      now: FIXED_NOW,
      verifyPaymentFn: async () => ({ paid: true }),
    });
    expect(bobSettle.ok).toBe(true);
    if (!bobSettle.ok) return;

    expect(bobSettle.market.poolYesMsat).toBe(3_000_000);
    expect(bobSettle.market.poolNoMsat).toBe(1_000_000);
    expect(impliedYesProbability(bobSettle.market.poolYesMsat, bobSettle.market.poolNoMsat)).toBe(0.75);

    const alicePositions = await listUserPositionsFromDb(db, alicePubkey, openMarketId);
    expect(alicePositions).toHaveLength(1);
    expect(alicePositions[0].status).toBe("CONFIRMED");

    // Ledger nets to 0 and escrow holds 4,000,000 msat
    const netSum = await db
      .select({ net: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
      .from(schema.ledgerEntries);
    expect(Number(netSum[0].net)).toBe(0);

    const escrowSum = await db
      .select({ total: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.account, "escrow"));
    expect(Number(escrowSum[0].total)).toBe(4_000_000);
  });

  it("marks payments arriving after bettingCutoff as LATE and queues a REFUND without polluting pools", async () => {
    const order = await placeBetOrder(db, {
      marketIdOrSlug: openMarketId,
      userPubkey: bobPubkey,
      side: "YES",
      amountSats: 500,
      now: FIXED_NOW,
    });
    expect(order.ok).toBe(true);
    if (!order.ok) return;

    // Webhook arrives 10s AFTER bettingCutoff
    const lateSettle = await settleBetByPaymentHash(db, {
      paymentHash: order.payment_hash,
      now: new Date(bettingCutoff.getTime() + 10_000),
      verifyPaymentFn: async () => ({ paid: true }),
    });
    expect(lateSettle.ok).toBe(true);
    if (!lateSettle.ok) return;

    expect(lateSettle.bet.status).toBe("LATE");
    expect(lateSettle.market.poolYesMsat).toBe(3_000_000); // unchanged
    expect(lateSettle.market.poolNoMsat).toBe(1_000_000); // unchanged

    const refunds = await db
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.userPubkey, bobPubkey));
    expect(refunds).toHaveLength(1);
    expect(refunds[0].kind).toBe("REFUND");
    expect(refunds[0].amountMsat).toBe(500_000);
    expect(refunds[0].status).toBe("QUEUED");

    const netSum = await db
      .select({ net: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
      .from(schema.ledgerEntries);
    expect(Number(netSum[0].net)).toBe(0);
  });
});
