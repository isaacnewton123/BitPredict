import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getPublicKey, type VerifiedEvent } from "nostr-tools/pure";
import * as schema from "@/lib/db/schema";
import { computeMarketSettlement } from "@/lib/domain/pool";
import { buildSettlementNoteEvent } from "@/lib/nostr/events";
import { getPlatformKeypair } from "@/lib/nostr/keys";
import { broadcastEventToRelays, getConfiguredRelays } from "@/lib/nostr/relay";
import { emitMarketPoolUpdate } from "./events";
import {
  getSettlementConfig,
  payLightningInvoice,
  requestInvoiceFromLightningAddress,
} from "./lnbits";

export type SettleMarketResult =
  | {
      ok: true;
      market: schema.Market;
      payouts: (typeof schema.payouts.$inferSelect)[];
      fee_msat: number;
      dust_msat: number;
      settlement_note_id: string | null;
    }
  | {
      ok: false;
      status: 404 | 409;
      code: string;
      message: string;
    };

export async function settleMarketAndDispatchPayouts(
  db: LibSQLDatabase<typeof schema>,
  marketIdOrSlug: string,
  opts: {
    now?: Date;
    maxRetries?: number;
    requestInvoiceFn?: typeof requestInvoiceFromLightningAddress;
    payInvoiceFn?: typeof payLightningInvoice;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
    platformSecretKey?: Uint8Array;
    appUrl?: string;
  } = {},
): Promise<SettleMarketResult> {
  const mktRows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, marketIdOrSlug), eq(schema.markets.slug, marketIdOrSlug)))
    .limit(1);

  const initialMarket = mktRows[0];
  if (!initialMarket) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Market not found" };
  }

  if (!["RESOLVED", "VOID", "SETTLING", "SETTLED"].includes(initialMarket.status)) {
    return {
      ok: false,
      status: 409,
      code: "MARKET_NOT_RESOLVED",
      message: `Market must be RESOLVED or VOID before settling (current: ${initialMarket.status})`,
    };
  }

  const now = opts.now ?? new Date();
  const maxRetries = opts.maxRetries ?? getSettlementConfig().payoutMaxRetries;
  const reqInvFn = opts.requestInvoiceFn ?? requestInvoiceFromLightningAddress;
  const payInvFn = opts.payInvoiceFn ?? payLightningInvoice;

  let feeMsat = 0;
  let dustMsat = 0;
  let isRefund = initialMarket.outcome === "INVALID" || initialMarket.outcome === null;

  // Step 1: Transition RESOLVED/VOID -> SETTLING, create payouts & close market:<id> ledger
  await db.transaction(async (tx) => {
    const transitioned = await tx
      .update(schema.markets)
      .set({ status: "SETTLING" })
      .where(
        and(
          eq(schema.markets.id, initialMarket.id),
          inArray(schema.markets.status, ["RESOLVED", "VOID"]),
        ),
      )
      .returning();

    if (transitioned.length === 0) return;

    const confirmedBets = await tx
      .select()
      .from(schema.bets)
      .where(
        and(
          eq(schema.bets.marketId, initialMarket.id),
          eq(schema.bets.status, "CONFIRMED"),
        ),
      );

    const plan = computeMarketSettlement({
      outcome: initialMarket.outcome,
      feeBps: initialMarket.feeBps,
      confirmedBets,
    });

    feeMsat = plan.feeMsat;
    dustMsat = plan.dustMsat;
    isRefund = plan.isRefund;

    if (plan.totalMsat <= 0) return;

    const ledgerRows: (typeof schema.ledgerEntries.$inferInsert)[] = [
      {
        account: `market:${initialMarket.id}`,
        amountMsat: plan.totalMsat,
        refType: plan.isRefund ? "refund" : "payout",
        refId: initialMarket.id,
        createdAt: now,
      },
    ];

    for (const item of plan.payouts) {
      await tx
        .insert(schema.payouts)
        .values({
          marketId: initialMarket.id,
          userPubkey: item.userPubkey,
          kind: item.kind,
          amountMsat: item.amountMsat,
          status: "QUEUED",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.payouts.marketId, schema.payouts.userPubkey, schema.payouts.kind],
          set: {
            amountMsat: sql`${schema.payouts.amountMsat} + ${item.amountMsat}`,
            status: "QUEUED",
            updatedAt: now,
          },
        });

      ledgerRows.push({
        account: `user:${item.userPubkey}`,
        amountMsat: -item.amountMsat,
        refType: item.kind === "WIN" ? "payout" : "refund",
        refId: initialMarket.id,
        createdAt: now,
      });
    }

    if (plan.feeMsat > 0) {
      ledgerRows.push({
        account: "fees",
        amountMsat: -plan.feeMsat,
        refType: "fee",
        refId: initialMarket.id,
        createdAt: now,
      });
    }
    if (plan.dustMsat > 0) {
      ledgerRows.push({
        account: "fees",
        amountMsat: -plan.dustMsat,
        refType: "dust",
        refId: initialMarket.id,
        createdAt: now,
      });
    }

    await tx.insert(schema.ledgerEntries).values(ledgerRows);
  });

  // Step 2: Dispatch pending QUEUED / FAILED payouts
  const pendingPayouts = await db
    .select()
    .from(schema.payouts)
    .where(
      and(
        eq(schema.payouts.marketId, initialMarket.id),
        inArray(schema.payouts.status, ["QUEUED", "FAILED"]),
      ),
    );

  const refundStatusesToMark: ("CONFIRMED" | "LATE")[] = isRefund ? ["CONFIRMED", "LATE"] : ["LATE"];

  for (const payout of pendingPayouts) {
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.pubkey, payout.userPubkey))
      .limit(1);
    const user = userRows[0];

    if (!user?.lightningAddress || payout.amountMsat < 1000) {
      const reason =
        payout.amountMsat < 1000
          ? "Amount below 1 satoshi — claim manually"
          : "No Lightning Address configured — claim manually with a bolt11 invoice";
      await db
        .update(schema.payouts)
        .set({ status: "CLAIMABLE", lastError: reason, updatedAt: now })
        .where(eq(schema.payouts.id, payout.id));
      continue;
    }

    const invRes = await reqInvFn(user.lightningAddress, payout.amountMsat, {
      forceSimulated: initialMarket.isDemo,
    });
    if (!invRes.ok) {
      const nextAttempts = payout.attempts + 1;
      await db
        .update(schema.payouts)
        .set({
          attempts: nextAttempts,
          status: nextAttempts >= maxRetries ? "CLAIMABLE" : "FAILED",
          lastError: invRes.error,
          updatedAt: now,
        })
        .where(eq(schema.payouts.id, payout.id));
      continue;
    }

    const payRes = await payInvFn(invRes.bolt11, {
      forceSimulated: initialMarket.isDemo,
    });
    if (!payRes.ok) {
      const nextAttempts = payout.attempts + 1;
      await db
        .update(schema.payouts)
        .set({
          attempts: nextAttempts,
          bolt11: invRes.bolt11,
          status: nextAttempts >= maxRetries ? "CLAIMABLE" : "FAILED",
          lastError: payRes.error,
          updatedAt: now,
        })
        .where(eq(schema.payouts.id, payout.id));
      continue;
    }

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.payouts)
        .set({
          status: "SENT",
          attempts: payout.attempts + 1,
          bolt11: invRes.bolt11,
          paymentHash: payRes.paymentHash,
          preimage: payRes.preimage,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.payouts.id, payout.id),
            inArray(schema.payouts.status, ["QUEUED", "FAILED"]),
          ),
        )
        .returning();

      if (updated.length === 0) return;

      const refType = payout.kind === "REFUND" ? "refund" : "payout";
      await tx.insert(schema.ledgerEntries).values([
        { account: "escrow", amountMsat: -payout.amountMsat, refType, refId: payout.id, createdAt: now },
        { account: `user:${payout.userPubkey}`, amountMsat: payout.amountMsat, refType, refId: payout.id, createdAt: now },
      ]);

      if (payout.kind === "REFUND") {
        await tx
          .update(schema.bets)
          .set({ status: "REFUNDED" })
          .where(
            and(
              eq(schema.bets.marketId, initialMarket.id),
              eq(schema.bets.userPubkey, payout.userPubkey),
              inArray(schema.bets.status, refundStatusesToMark),
            ),
          );
      }
    });
  }

  // Step 3: Transition to SETTLED if no payouts remain QUEUED / SENDING / FAILED
  const allPayouts = await db
    .select()
    .from(schema.payouts)
    .where(eq(schema.payouts.marketId, initialMarket.id));

  const remaining = allPayouts.filter((p) =>
    p.status === "QUEUED" || p.status === "SENDING" || p.status === "FAILED",
  );

  let settlementNoteId: string | null = null;
  let finalMarket = (
    await db.select().from(schema.markets).where(eq(schema.markets.id, initialMarket.id)).limit(1)
  )[0];

  if (remaining.length === 0 && finalMarket.status === "SETTLING") {
    const settledRows = await db
      .update(schema.markets)
      .set({ status: "SETTLED" })
      .where(and(eq(schema.markets.id, initialMarket.id), eq(schema.markets.status, "SETTLING")))
      .returning();

    if (settledRows.length > 0) {
      finalMarket = settledRows[0];
      const platformKeys = opts.platformSecretKey
        ? {
            secretKey: opts.platformSecretKey,
            pubkey: getPublicKey(opts.platformSecretKey).toLowerCase(),
          }
        : getPlatformKeypair();

      const totalPaidMsat = allPayouts.reduce((sum, p) => sum + p.amountMsat, 0);
      const totalPoolSats = Math.floor((finalMarket.poolYesMsat + finalMarket.poolNoMsat) / 1000);
      const settlementEvent = buildSettlementNoteEvent({
        slug: finalMarket.slug,
        marketNoteId: finalMarket.nostrNoteId,
        platformPubkey: platformKeys.pubkey,
        outcome: finalMarket.outcome,
        totalPoolSats,
        paidSats: Math.floor(totalPaidMsat / 1000),
        feeSats: Math.floor((feeMsat + dustMsat) / 1000),
        payoutCount: allPayouts.length,
        isRefund,
        appUrl: opts.appUrl,
        createdAtSec: Math.floor(now.getTime() / 1000),
        secretKey: platformKeys.secretKey,
      });

      const relays = getConfiguredRelays();
      const broadcast =
        opts.broadcastFn ??
        (finalMarket.isDemo
          ? async () => [] as string[]
          : (ev: VerifiedEvent, r: string[]) => broadcastEventToRelays(ev, r));
      const relaysOk = await broadcast(settlementEvent, relays);
      settlementNoteId = settlementEvent.id;

      await db
        .insert(schema.nostrEvents)
        .values({
          id: settlementEvent.id,
          marketId: finalMarket.id,
          kind: settlementEvent.kind,
          event: settlementEvent,
          relaysOk,
        })
        .onConflictDoNothing();

      emitMarketPoolUpdate({
        market_id: finalMarket.id,
        pool_yes_msat: finalMarket.poolYesMsat,
        pool_no_msat: finalMarket.poolNoMsat,
        status: finalMarket.status,
        outcome: finalMarket.outcome,
        updated_at: now.toISOString(),
      });
    }
  }

  return {
    ok: true,
    market: finalMarket,
    payouts: allPayouts,
    fee_msat: feeMsat,
    dust_msat: dustMsat,
    settlement_note_id: settlementNoteId,
  };
}

export type ClaimPayoutResult =
  | { ok: true; payout: typeof schema.payouts.$inferSelect }
  | { ok: false; status: 403 | 404 | 409 | 422 | 502; code: string; message: string };

export async function claimPayoutWithBolt11(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    payoutId: string;
    userPubkey: string;
    bolt11?: string;
    now?: Date;
    payInvoiceFn?: typeof payLightningInvoice;
  },
): Promise<ClaimPayoutResult> {
  const rows = await db
    .select()
    .from(schema.payouts)
    .where(eq(schema.payouts.id, opts.payoutId))
    .limit(1);
  const payout = rows[0];
  if (!payout) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Payout not found" };
  }
  if (payout.userPubkey !== opts.userPubkey.toLowerCase()) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Not payout owner" };
  }
  if (!["CLAIMABLE", "FAILED", "QUEUED"].includes(payout.status)) {
    return { ok: false, status: 409, code: "ALREADY_CLAIMED", message: `Payout is already ${payout.status}` };
  }

  const mktRows = await db
    .select({ isDemo: schema.markets.isDemo })
    .from(schema.markets)
    .where(eq(schema.markets.id, payout.marketId))
    .limit(1);
  const isDemoMarket = Boolean(mktRows[0]?.isDemo);

  let invoice = opts.bolt11?.trim() ?? "";
  if (!invoice) {
    if (!isDemoMarket && process.env.DEMO_MODE === "false") {
      return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Provide a bolt11 Lightning invoice" };
    }
    const h = createHash("sha256").update(`claim:${payout.id}:${Date.now()}`).digest("hex");
    invoice = `lnbcsimclaim${Math.floor(payout.amountMsat / 1000)}0n1p${h.slice(0, 24)}`;
  } else if (!/^ln[a-z0-9]+$/i.test(invoice) || invoice.length < 16) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Invalid bolt11 Lightning invoice" };
  }

  const payFn = opts.payInvoiceFn ?? payLightningInvoice;
  const payRes = await payFn(invoice, { forceSimulated: isDemoMarket });
  if (!payRes.ok) {
    return { ok: false, status: 502, code: "LIGHTNING_ERROR", message: payRes.error };
  }

  const now = opts.now ?? new Date();
  const updatedPayout = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.payouts)
      .set({
        status: "SENT",
        attempts: payout.attempts + 1,
        bolt11: invoice,
        paymentHash: payRes.paymentHash,
        preimage: payRes.preimage,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.payouts.id, payout.id),
          inArray(schema.payouts.status, ["CLAIMABLE", "FAILED", "QUEUED"]),
        ),
      )
      .returning();

    if (updated.length === 0) return null;

    const refType = payout.kind === "REFUND" ? "refund" : "payout";
    await tx.insert(schema.ledgerEntries).values([
      { account: "escrow", amountMsat: -payout.amountMsat, refType, refId: payout.id, createdAt: now },
      { account: `user:${payout.userPubkey}`, amountMsat: payout.amountMsat, refType, refId: payout.id, createdAt: now },
    ]);

    const remaining = await tx
      .select()
      .from(schema.payouts)
      .where(
        and(
          eq(schema.payouts.marketId, payout.marketId),
          inArray(schema.payouts.status, ["QUEUED", "SENDING", "FAILED"]),
        ),
      );
    if (remaining.length === 0) {
      await tx
        .update(schema.markets)
        .set({ status: "SETTLED" })
        .where(and(eq(schema.markets.id, payout.marketId), eq(schema.markets.status, "SETTLING")));
    }

    return updated[0];
  });

  if (!updatedPayout) {
    return { ok: false, status: 409, code: "ALREADY_CLAIMED", message: "Payout already claimed" };
  }
  return { ok: true, payout: updatedPayout };
}

export async function listUserPayoutsFromDb(
  db: LibSQLDatabase<typeof schema>,
  userPubkey: string,
  marketId?: string,
  isDemo?: boolean,
) {
  const conditions = [eq(schema.payouts.userPubkey, userPubkey.toLowerCase())];
  if (marketId) {
    conditions.push(eq(schema.payouts.marketId, marketId));
  }
  if (isDemo !== undefined) {
    conditions.push(eq(schema.markets.isDemo, isDemo));
  }
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select({
      payout: schema.payouts,
      market: {
        id: schema.markets.id,
        slug: schema.markets.slug,
        title: schema.markets.title,
        status: schema.markets.status,
        outcome: schema.markets.outcome,
        isDemo: schema.markets.isDemo,
      },
    })
    .from(schema.payouts)
    .innerJoin(schema.markets, eq(schema.payouts.marketId, schema.markets.id))
    .where(where)
    .orderBy(desc(schema.payouts.updatedAt))
    .limit(100);

  return rows.map(({ payout, market }) => ({
    ...payout,
    market,
  }));
}
