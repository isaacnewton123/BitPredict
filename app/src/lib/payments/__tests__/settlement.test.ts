import { createClient, type Client } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { generateSecretKey, verifyEvent, type Event as NostrEvent } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileMarketPrompt } from "@/lib/ai/compiler";
import * as schema from "@/lib/db/schema";
import { applyTestMigrations } from "@/lib/db/test-migrations";
import { computeMarketSettlement } from "@/lib/domain/pool";
import { createMarketDraft } from "@/lib/markets/draft-repo";
import { publishMarketDraft } from "@/lib/markets/publish-repo";
import { TEXT_NOTE_KIND } from "@/lib/nostr/events";
import { runOracleTick } from "@/lib/oracle/worker-repo";
import { placeBetOrder, settleBetByPaymentHash } from "@/lib/payments/bet-repo";
import {
  claimPayoutWithBolt11,
  listUserPayoutsFromDb,
  settleMarketAndDispatchPayouts,
} from "@/lib/payments/settlement-repo";

const FIXED_NOW = new Date("2026-11-19T12:00:00Z");

describe("computeMarketSettlement (parimutuel msat math)", () => {
  it("computes two-sided split with 2% fee on losing pool and conserves dust exactly", () => {
    const plan = computeMarketSettlement({
      outcome: "YES",
      feeBps: 200,
      confirmedBets: [
        { userPubkey: "u1", side: "YES", amountMsat: 333_000 },
        { userPubkey: "u2", side: "YES", amountMsat: 333_000 },
        { userPubkey: "u3", side: "YES", amountMsat: 333_000 },
        { userPubkey: "u4", side: "NO", amountMsat: 1_000_000 },
      ],
    });

    expect(plan.isRefund).toBe(false);
    expect(plan.totalMsat).toBe(1_999_000);
    expect(plan.feeMsat).toBe(20_000);
    const paid = plan.payouts.reduce((acc, p) => acc + p.amountMsat, 0);
    expect(paid + plan.feeMsat + plan.dustMsat).toBe(plan.totalMsat);
    expect(plan.payouts.every((p) => p.kind === "WIN" && p.amountMsat >= 333_000)).toBe(true);
  });

  it("refunds 100% with zero fee on one-sided pools and VOID markets", () => {
    const oneSided = computeMarketSettlement({
      outcome: "YES",
      feeBps: 200,
      confirmedBets: [
        { userPubkey: "u1", side: "YES", amountMsat: 500_000 },
        { userPubkey: "u2", side: "YES", amountMsat: 250_000 },
      ],
    });
    expect(oneSided.isRefund).toBe(true);
    expect(oneSided.feeMsat).toBe(0);
    expect(oneSided.dustMsat).toBe(0);
    expect(oneSided.payouts).toEqual([
      { userPubkey: "u1", kind: "REFUND", amountMsat: 500_000 },
      { userPubkey: "u2", kind: "REFUND", amountMsat: 250_000 },
    ]);

    const voided = computeMarketSettlement({
      outcome: "INVALID",
      feeBps: 200,
      confirmedBets: [
        { userPubkey: "u1", side: "YES", amountMsat: 400_000 },
        { userPubkey: "u2", side: "NO", amountMsat: 600_000 },
      ],
    });
    expect(voided.isRefund).toBe(true);
    expect(voided.feeMsat).toBe(0);
    expect(voided.payouts).toHaveLength(2);
  });
});

describe("End-to-end Resolution -> Automatic Lightning Payouts & Claim Flow", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  const creatorPubkey = "1".repeat(64);
  const alicePubkey = "a".repeat(64);
  const bobPubkey = "b".repeat(64);
  const carolPubkey = "c".repeat(64); // no lightning address
  const davePubkey = "d".repeat(64); // failing lightning address
  const oracleSk = generateSecretKey();

  beforeAll(async () => {
    client = createClient({ url: ":memory:" });
    await client.execute("PRAGMA foreign_keys = ON;");
    await applyTestMigrations(client);
    db = drizzle(client, { schema });

    await db.insert(schema.users).values([
      { pubkey: creatorPubkey },
      { pubkey: alicePubkey, lightningAddress: "alice@getalby.com" },
      { pubkey: bobPubkey, lightningAddress: "bob@getalby.com" },
      { pubkey: carolPubkey, lightningAddress: null },
      { pubkey: davePubkey, lightningAddress: "dave@broken.test" },
    ]);
  });

  afterAll(() => {
    client.close();
  });

  async function createOpenBtcMarket(suffix: string) {
    const compiled = await compileMarketPrompt({
      prompt: `Will BTC be above $100,000 in 5 minutes? (${suffix})`,
      now: FIXED_NOW,
      apiKey: "",
    });
    if (!compiled.ok) throw new Error("Failed to compile BTC market");
    const draft = await createMarketDraft(db, {
      creatorPubkey,
      prompt: `Will BTC be above $100,000 in 5 minutes?`,
      compiled,
    });
    const pub = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      now: FIXED_NOW,
      broadcastFn: async () => [],
    });
    if (!pub.ok) throw new Error("Failed to publish BTC market");
    return pub.market;
  }

  async function confirmBet(marketId: string, userPubkey: string, side: "YES" | "NO", amountSats: number) {
    const order = await placeBetOrder(db, {
      marketIdOrSlug: marketId,
      userPubkey,
      side,
      amountSats,
      now: FIXED_NOW,
    });
    if (!order.ok) throw new Error(`Bet order failed: ${order.message}`);
    const settled = await settleBetByPaymentHash(db, {
      paymentHash: order.payment_hash,
      now: FIXED_NOW,
      verifyPaymentFn: async () => ({ paid: true }),
    });
    if (!settled.ok) throw new Error(`Bet settle failed: ${settled.message}`);
  }

  it("auto-settles a 5-min BTC market, pays Alice 3,980 sats, emits Settlement Note, and balances ledger", async () => {
    const mkt = await createOpenBtcMarket("e2e");
    await confirmBet(mkt.id, alicePubkey, "YES", 3_000);
    await confirmBet(mkt.id, bobPubkey, "NO", 1_000);

    // Advance past resolveAfter and run Track A oracle tick (Binance price = 101,500 > 100,000 -> YES)
    const resolveTime = new Date(mkt.resolveAfter.getTime() + 5_000);
    await runOracleTick(db, {
      now: resolveTime,
      oracleSecretKey: oracleSk,
      broadcastFn: async () => [],
      fetchFn: async () =>
        new Response(JSON.stringify([[1, "100000", "102000", "99500", "101500.00", "10"]]), {
          status: 200,
        }),
    });

    const mktRows = await db.select().from(schema.markets).where(eq(schema.markets.id, mkt.id));
    expect(mktRows[0].status).toBe("SETTLED");
    expect(mktRows[0].outcome).toBe("YES");

    const alicePayouts = await listUserPayoutsFromDb(db, alicePubkey, mkt.id);
    expect(alicePayouts).toHaveLength(1);
    expect(alicePayouts[0].kind).toBe("WIN");
    expect(alicePayouts[0].amountMsat).toBe(3_980_000); // 3,000 + 980 sats
    expect(alicePayouts[0].status).toBe("SENT");
    expect(alicePayouts[0].preimage).toMatch(/^[0-9a-f]{64}$/);

    // Kind 1 settlement note stored
    const noteRows = await db
      .select()
      .from(schema.nostrEvents)
      .where(eq(schema.nostrEvents.marketId, mkt.id));
    const settlementNotes = noteRows.filter(
      (n) => n.kind === TEXT_NOTE_KIND && JSON.stringify(n.event).includes("Market Settled"),
    );
    expect(settlementNotes).toHaveLength(1);
    expect(verifyEvent(settlementNotes[0].event as NostrEvent)).toBe(true);

    // Double-entry ledger reconciliation
    const netSum = await db
      .select({ net: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
      .from(schema.ledgerEntries);
    expect(Number(netSum[0].net)).toBe(0);

    const mktAcct = await db
      .select({ bal: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.account, `market:${mkt.id}`));
    expect(Number(mktAcct[0].bal)).toBe(0);

    const escrowAcct = await db
      .select({ bal: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.account, "escrow"));
    expect(Number(escrowAcct[0].bal)).toBe(20_000); // exact 2% fee kept
  });

  it("handles missing address / 3 failed retries -> CLAIMABLE, then manual claim transitions to SENT & SETTLED", async () => {
    const mkt = await createOpenBtcMarket("claimable");
    await confirmBet(mkt.id, carolPubkey, "YES", 500);
    await confirmBet(mkt.id, davePubkey, "YES", 500);
    await confirmBet(mkt.id, bobPubkey, "NO", 1_000);

    // Resolve market manually in DB to RESOLVED YES (skip auto-settle so we can inject failing LNURL for Dave)
    await db
      .update(schema.markets)
      .set({ status: "RESOLVED", outcome: "YES", resolvedAt: FIXED_NOW })
      .where(eq(schema.markets.id, mkt.id));

    const failingInv = async () => ({ ok: false as const, error: "LNURL timeout" });

    // Attempt 1: Carol -> immediate CLAIMABLE (no lightning address); Dave -> FAILED (attempt 1)
    const r1 = await settleMarketAndDispatchPayouts(db, mkt.id, {
      maxRetries: 3,
      requestInvoiceFn: failingInv,
      broadcastFn: async () => [],
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.market.status).toBe("SETTLING");

    // Attempt 2: Dave -> FAILED (attempt 2)
    await settleMarketAndDispatchPayouts(db, mkt.id, {
      maxRetries: 3,
      requestInvoiceFn: failingInv,
      broadcastFn: async () => [],
    });

    // Attempt 3: Dave -> CLAIMABLE (attempt 3 >= maxRetries), market -> SETTLED
    const r3 = await settleMarketAndDispatchPayouts(db, mkt.id, {
      maxRetries: 3,
      requestInvoiceFn: failingInv,
      broadcastFn: async () => [],
    });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.market.status).toBe("SETTLED");

    const carolPayouts = await listUserPayoutsFromDb(db, carolPubkey, mkt.id);
    const davePayouts = await listUserPayoutsFromDb(db, davePubkey, mkt.id);
    expect(carolPayouts[0].status).toBe("CLAIMABLE");
    expect(davePayouts[0].status).toBe("CLAIMABLE");
    expect(davePayouts[0].attempts).toBe(3);

    // Carol claims manually with a bolt11 invoice
    const claimed = await claimPayoutWithBolt11(db, {
      payoutId: carolPayouts[0].id,
      userPubkey: carolPubkey,
      bolt11: "lnbc9900n1pmanualclaimtestinvoice0001",
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.payout.status).toBe("SENT");
    expect(claimed.payout.preimage).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refunds 100% with 0 fee on one-sided market pools", async () => {
    const mkt = await createOpenBtcMarket("onesided");
    await confirmBet(mkt.id, alicePubkey, "YES", 750);

    await db
      .update(schema.markets)
      .set({ status: "RESOLVED", outcome: "NO", resolvedAt: FIXED_NOW })
      .where(eq(schema.markets.id, mkt.id));

    const settled = await settleMarketAndDispatchPayouts(db, mkt.id, {
      broadcastFn: async () => [],
    });
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;

    expect(settled.fee_msat).toBe(0);
    expect(settled.market.status).toBe("SETTLED");

    const payouts = await listUserPayoutsFromDb(db, alicePubkey, mkt.id);
    expect(payouts[0].kind).toBe("REFUND");
    expect(payouts[0].amountMsat).toBe(750_000);
    expect(payouts[0].status).toBe("SENT");

    const bets = await db.select().from(schema.bets).where(eq(schema.bets.marketId, mkt.id));
    expect(bets[0].status).toBe("REFUNDED");
  });
});
