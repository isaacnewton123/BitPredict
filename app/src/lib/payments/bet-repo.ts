import { and, desc, eq, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import QRCode from "qrcode";
import * as schema from "@/lib/db/schema";
import { SIDES, type Side } from "@/lib/domain/constants";
import { estimatePotentialPayoutMsat } from "@/lib/domain/pool";
import { emitMarketPoolUpdate } from "./events";
import {
  createLightningInvoice,
  getBetLimits,
  verifyLightningPayment,
} from "./lnbits";

export type PlaceBetResult =
  | {
      ok: true;
      bet_id: string;
      market_id: string;
      side: Side;
      amount_sats: number;
      amount_msat: number;
      bolt11: string;
      payment_hash: string;
      expires_at: string;
      simulated: boolean;
      qr_data_url?: string | null;
    }
  | {
      ok: false;
      status: 403 | 404 | 409 | 422 | 502;
      code: string;
      message: string;
    };

export async function placeBetOrder(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    marketIdOrSlug: string;
    userPubkey: string;
    side: Side;
    amountSats: number;
    now?: Date;
    webhookUrl?: string;
    createInvoiceFn?: typeof createLightningInvoice;
  },
): Promise<PlaceBetResult> {
  if (!(SIDES as readonly string[]).includes(opts.side)) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Side must be YES or NO" };
  }

  const limits = getBetLimits();
  if (
    !Number.isInteger(opts.amountSats) ||
    opts.amountSats < limits.minBetSats ||
    opts.amountSats > limits.maxBetSats
  ) {
    return {
      ok: false,
      status: 422,
      code: "BET_LIMIT",
      message: `Bet must be an integer between ${limits.minBetSats} and ${limits.maxBetSats} sats`,
    };
  }

  const marketRows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, opts.marketIdOrSlug), eq(schema.markets.slug, opts.marketIdOrSlug)))
    .limit(1);
  const market = marketRows[0];
  if (!market) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Market not found" };
  }

  const normalizedPubkey = opts.userPubkey.toLowerCase();
  const userRows = await db
    .select({ isGuest: schema.users.isGuest })
    .from(schema.users)
    .where(eq(schema.users.pubkey, normalizedPubkey))
    .limit(1);
  const bettor = userRows[0];

  if (market.isDemo && bettor && !bettor.isGuest) {
    return {
      ok: false,
      status: 403,
      code: "MODE_MISMATCH",
      message: "This is a Demo Sandbox market. Switch to a Demo Account to trade here.",
    };
  }
  if (!market.isDemo && bettor?.isGuest) {
    return {
      ok: false,
      status: 403,
      code: "MODE_MISMATCH",
      message:
        "Demo accounts can only trade on Demo Sandbox markets. Sign in with a Live Nostr account to trade live markets.",
    };
  }

  const now = opts.now ?? new Date();
  const secLeft = Math.floor((market.bettingCutoff.getTime() - now.getTime()) / 1000);
  if (market.status !== "OPEN" || secLeft < 5) {
    return { ok: false, status: 409, code: "MARKET_CLOSED", message: "Betting cutoff has passed or market is closed" };
  }

  const signerConflict = await db
    .select({ id: schema.proposals.id })
    .from(schema.proposals)
    .where(
      and(
        eq(schema.proposals.marketId, market.id),
        eq(schema.proposals.signerPubkey, opts.userPubkey.toLowerCase()),
      ),
    )
    .limit(1);

  if (signerConflict.length > 0) {
    return {
      ok: false,
      status: 403,
      code: "SIGNER_CONFLICT_OF_INTEREST",
      message: "Oracle signers cannot bet on a market they proposed",
    };
  }

  const expirySec = Math.min(limits.invoiceExpirySec, secLeft);
  const createFn = opts.createInvoiceFn ?? createLightningInvoice;

  let invoice;
  try {
    invoice = await createFn({
      amountSats: opts.amountSats,
      memo: `BitPredict ${opts.side}: ${market.title}`,
      expirySec,
      webhookUrl: opts.webhookUrl,
      forceSimulated: market.isDemo,
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: "LIGHTNING_ERROR",
      message: err instanceof Error ? err.message : "Failed to create Lightning invoice",
    };
  }

  let qrDataUrl: string | null = null;
  if (!invoice.simulated) {
    try {
      qrDataUrl = await QRCode.toDataURL(`lightning:${invoice.bolt11}`, {
        margin: 1,
        width: 240,
      });
    } catch {
      qrDataUrl = null;
    }
  }

  const betId = crypto.randomUUID();
  const amountMsat = opts.amountSats * 1000;

  await db.insert(schema.bets).values({
    id: betId,
    marketId: market.id,
    userPubkey: normalizedPubkey,
    side: opts.side,
    amountMsat,
    paymentHash: invoice.paymentHash,
    bolt11: invoice.bolt11,
    status: "PENDING",
  });

  return {
    ok: true,
    bet_id: betId,
    market_id: market.id,
    side: opts.side,
    amount_sats: opts.amountSats,
    amount_msat: amountMsat,
    bolt11: invoice.bolt11,
    payment_hash: invoice.paymentHash,
    expires_at: new Date(now.getTime() + expirySec * 1000).toISOString(),
    simulated: invoice.simulated,
    qr_data_url: qrDataUrl,
  };
}

export type SettleBetResult =
  | {
      ok: true;
      idempotent: boolean;
      bet: schema.Bet;
      market: schema.Market;
    }
  | {
      ok: false;
      status: 402 | 404;
      code: string;
      message: string;
    };

export async function settleBetByPaymentHash(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    paymentHash: string;
    now?: Date;
    verifyPaymentFn?: typeof verifyLightningPayment;
  },
): Promise<SettleBetResult> {
  const existingRows = await db
    .select()
    .from(schema.bets)
    .where(eq(schema.bets.paymentHash, opts.paymentHash))
    .limit(1);
  const existing = existingRows[0];
  if (!existing) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Bet not found for payment_hash" };
  }

  if (existing.status === "CONFIRMED" || existing.status === "LATE" || existing.status === "REFUNDED") {
    const mktRows = await db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, existing.marketId))
      .limit(1);
    return { ok: true, idempotent: true, bet: existing, market: mktRows[0] };
  }

  const mktPreRows = await db
    .select({ isDemo: schema.markets.isDemo })
    .from(schema.markets)
    .where(eq(schema.markets.id, existing.marketId))
    .limit(1);

  const verifyFn = opts.verifyPaymentFn ?? verifyLightningPayment;
  const verified = await verifyFn(opts.paymentHash, {
    bolt11: existing.bolt11,
    allowSimulated: Boolean(mktPreRows[0]?.isDemo),
  });
  if (!verified.paid) {
    return { ok: false, status: 402, code: "PAYMENT_NOT_PAID", message: "Invoice has not been paid" };
  }

  const now = opts.now ?? new Date();

  const txOut = await db.transaction(async (tx) => {
    const mktRows = await tx
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.id, existing.marketId))
      .limit(1);
    const market = mktRows[0];

    const onTime = market.status === "OPEN" && now.getTime() < market.bettingCutoff.getTime();
    const nextStatus = onTime ? "CONFIRMED" : "LATE";

    const updatedBetRows = await tx
      .update(schema.bets)
      .set({ status: nextStatus, paidAt: now })
      .where(and(eq(schema.bets.id, existing.id), eq(schema.bets.status, "PENDING")))
      .returning();

    if (updatedBetRows.length === 0) {
      const currentBetRows = await tx
        .select()
        .from(schema.bets)
        .where(eq(schema.bets.id, existing.id))
        .limit(1);
      return { idempotent: true, bet: currentBetRows[0], market };
    }

    const updatedBet = updatedBetRows[0];

    if (onTime) {
      const poolPatch =
        existing.side === "YES"
          ? { poolYesMsat: sql`${schema.markets.poolYesMsat} + ${existing.amountMsat}` }
          : { poolNoMsat: sql`${schema.markets.poolNoMsat} + ${existing.amountMsat}` };

      const updatedMarketRows = await tx
        .update(schema.markets)
        .set(poolPatch)
        .where(eq(schema.markets.id, market.id))
        .returning();

      await tx.insert(schema.ledgerEntries).values([
        { account: "escrow", amountMsat: existing.amountMsat, refType: "bet", refId: existing.id },
        { account: `market:${market.id}`, amountMsat: -existing.amountMsat, refType: "bet", refId: existing.id },
      ]);

      return { idempotent: false, bet: updatedBet, market: updatedMarketRows[0] };
    }

    // Late payment: do NOT add to betting pool; queue full refund.
    await tx
      .insert(schema.payouts)
      .values({
        marketId: market.id,
        userPubkey: existing.userPubkey,
        kind: "REFUND",
        amountMsat: existing.amountMsat,
        status: "QUEUED",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.payouts.marketId, schema.payouts.userPubkey, schema.payouts.kind],
        set: {
          amountMsat: sql`${schema.payouts.amountMsat} + ${existing.amountMsat}`,
          updatedAt: now,
        },
      });

    await tx.insert(schema.ledgerEntries).values([
      { account: "escrow", amountMsat: existing.amountMsat, refType: "bet", refId: existing.id },
      { account: `user:${existing.userPubkey}`, amountMsat: -existing.amountMsat, refType: "refund", refId: existing.id },
    ]);

    return { idempotent: false, bet: updatedBet, market };
  });

  if (!txOut.idempotent) {
    emitMarketPoolUpdate({
      market_id: txOut.market.id,
      pool_yes_msat: txOut.market.poolYesMsat,
      pool_no_msat: txOut.market.poolNoMsat,
      status: txOut.market.status,
      outcome: txOut.market.outcome,
      updated_at: now.toISOString(),
    });
  }

  return {
    ok: true,
    idempotent: txOut.idempotent,
    bet: txOut.bet,
    market: txOut.market,
  };
}

export async function getBetByIdFromDb(db: LibSQLDatabase<typeof schema>, betId: string) {
  const rows = await db.select().from(schema.bets).where(eq(schema.bets.id, betId)).limit(1);
  return rows[0];
}

export async function listUserPositionsFromDb(
  db: LibSQLDatabase<typeof schema>,
  userPubkey: string,
  marketId?: string,
) {
  const where = marketId
    ? and(eq(schema.bets.userPubkey, userPubkey.toLowerCase()), eq(schema.bets.marketId, marketId))
    : eq(schema.bets.userPubkey, userPubkey.toLowerCase());

  const rows = await db
    .select({
      bet: schema.bets,
      market: {
        id: schema.markets.id,
        slug: schema.markets.slug,
        title: schema.markets.title,
        category: schema.markets.category,
        status: schema.markets.status,
        outcome: schema.markets.outcome,
        poolYesMsat: schema.markets.poolYesMsat,
        poolNoMsat: schema.markets.poolNoMsat,
        feeBps: schema.markets.feeBps,
        isDemo: schema.markets.isDemo,
      },
    })
    .from(schema.bets)
    .innerJoin(schema.markets, eq(schema.bets.marketId, schema.markets.id))
    .where(where)
    .orderBy(desc(schema.bets.createdAt))
    .limit(100);

  return rows.map(({ bet, market }) => {
    const winPool = bet.side === "YES" ? market.poolYesMsat : market.poolNoMsat;
    const est =
      bet.status === "CONFIRMED" && winPool >= bet.amountMsat
        ? estimatePotentialPayoutMsat({
            side: bet.side,
            stakeMsat: bet.amountMsat,
            poolYesMsat: Math.max(0, market.poolYesMsat - (bet.side === "YES" ? bet.amountMsat : 0)),
            poolNoMsat: Math.max(0, market.poolNoMsat - (bet.side === "NO" ? bet.amountMsat : 0)),
            feeBps: market.feeBps,
          })
        : null;

    return {
      bet_id: bet.id,
      side: bet.side,
      amount_msat: bet.amountMsat,
      status: bet.status,
      paid_at: bet.paidAt,
      created_at: bet.createdAt,
      estimated_payout_msat: est?.payoutMsat ?? null,
      market,
    };
  });
}
