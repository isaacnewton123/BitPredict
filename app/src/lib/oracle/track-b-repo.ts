import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as nip19 from "nostr-tools/nip19";
import { verifyEvent, type VerifiedEvent } from "nostr-tools/pure";
import { z } from "zod";
import * as schema from "@/lib/db/schema";
import { OUTCOMES, type Outcome } from "@/lib/domain/constants";
import { DISPUTE_EVENT_KIND, OUTCOME_ATTESTATION_KIND } from "@/lib/nostr/events";
import { broadcastEventToRelays, getConfiguredRelays } from "@/lib/nostr/relay";
import { emitMarketPoolUpdate } from "@/lib/payments/events";
import { createLightningInvoice } from "@/lib/payments/lnbits";
import { settleMarketAndDispatchPayouts } from "@/lib/payments/settlement-repo";

export function getChallengeWindowSec(isDemoMarket = false): number {
  if (isDemoMarket) {
    return 120;
  }
  const raw = process.env.CHALLENGE_WINDOW_SEC?.trim();
  if (!raw && process.env.DEMO_MODE !== "false") {
    return 120;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 10) {
    return Math.floor(n);
  }
  return process.env.DEMO_MODE !== "false" ? 120 : 3600;
}

export function getDisputeBondSats(): number {
  const n = Number(process.env.DISPUTE_BOND_SATS);
  return Number.isFinite(n) && n >= 10 ? Math.floor(n) : 1000;
}

function parsePubkeyList(raw?: string): Set<string> {
  const out = new Set<string>();
  if (!raw?.trim()) return out;
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!token) continue;
    if (token.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(token);
        if (decoded.type === "npub") out.add(decoded.data.toLowerCase());
      } catch {
        // ignore invalid npub
      }
    } else if (/^[0-9a-f]{64}$/i.test(token)) {
      out.add(token.toLowerCase());
    }
  }
  return out;
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const SignedEventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/i),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/i),
  created_at: z.number().int().positive(),
  kind: z.number().int().nonnegative(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[0-9a-f]{128}$/i),
});

export async function isAuthorizedSigner(
  db: LibSQLDatabase<typeof schema>,
  pubkey: string,
  allowedOverride?: string[],
): Promise<boolean> {
  const normalized = pubkey.toLowerCase();
  const dbRows = await db
    .select()
    .from(schema.signers)
    .where(eq(schema.signers.pubkey, normalized))
    .limit(1);

  if (dbRows[0]) {
    if (!dbRows[0].active) return false;
    if (!allowedOverride) return true;
  }

  const allowSet = allowedOverride
    ? new Set(allowedOverride.map((k) => k.toLowerCase()))
    : parsePubkeyList(process.env.ORACLE_SIGNER_PUBKEYS);

  if (allowSet.size > 0) {
    return allowSet.has(normalized);
  }

  return process.env.DEMO_MODE !== "false";
}

export function isAuthorizedAdmin(pubkey: string, allowedOverride?: string[]): boolean {
  const normalized = pubkey.toLowerCase();
  const allowSet = allowedOverride
    ? new Set(allowedOverride.map((k) => k.toLowerCase()))
    : parsePubkeyList(process.env.ADMIN_PUBKEYS);

  if (allowSet.size > 0) {
    return allowSet.has(normalized);
  }
  return process.env.DEMO_MODE !== "false";
}

/**
 * Enforces docs/05-oracle-design.md §4: Signers cannot bet on markets they resolve
 * (checked by pubkey and shared Lightning Address).
 */
export async function hasSignerConflictOfInterest(
  db: LibSQLDatabase<typeof schema>,
  marketId: string,
  signerPubkey: string,
): Promise<boolean> {
  const normalized = signerPubkey.toLowerCase();

  const directBets = await db
    .select({ id: schema.bets.id })
    .from(schema.bets)
    .where(and(eq(schema.bets.marketId, marketId), eq(schema.bets.userPubkey, normalized)))
    .limit(1);
  if (directBets.length > 0) return true;

  const signerUser = await db
    .select({ lightningAddress: schema.users.lightningAddress })
    .from(schema.users)
    .where(eq(schema.users.pubkey, normalized))
    .limit(1);

  const lnAddr = signerUser[0]?.lightningAddress?.trim().toLowerCase();
  if (!lnAddr) return false;

  const sameAddrBets = await db
    .select({ id: schema.bets.id })
    .from(schema.bets)
    .innerJoin(schema.users, eq(schema.bets.userPubkey, schema.users.pubkey))
    .where(and(eq(schema.bets.marketId, marketId), eq(schema.users.lightningAddress, lnAddr)))
    .limit(1);

  return sameAddrBets.length > 0;
}

export type SubmitProposalResult =
  | {
      ok: true;
      proposal: typeof schema.proposals.$inferSelect;
      market: schema.Market;
    }
  | {
      ok: false;
      status: 403 | 404 | 409 | 422;
      code: string;
      message: string;
    };

export async function submitTrackBProposal(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    marketIdOrSlug: string;
    nostrEvent: unknown;
    now?: Date;
    forceReadyInDemo?: boolean;
    allowedSigners?: string[];
    challengeWindowSec?: number;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
  },
): Promise<SubmitProposalResult> {
  const mktRows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, opts.marketIdOrSlug), eq(schema.markets.slug, opts.marketIdOrSlug)))
    .limit(1);
  const market = mktRows[0];
  if (!market) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Market not found" };
  }
  if (market.track !== "nostr_oracle") {
    return { ok: false, status: 409, code: "INVALID_TRACK", message: "Only nostr_oracle markets accept signer proposals" };
  }

  const now = opts.now ?? new Date();
  const canAutoTransition =
    (market.status === "OPEN" || market.status === "CLOSED") &&
    (now.getTime() >= market.resolveAfter.getTime() ||
      (Boolean(opts.forceReadyInDemo) && (market.isDemo || process.env.DEMO_MODE !== "false")));

  if (market.status !== "PENDING_RESOLUTION" && !canAutoTransition) {
    return {
      ok: false,
      status: 409,
      code: "MARKET_NOT_PENDING_RESOLUTION",
      message: `Market status is ${market.status}, expected PENDING_RESOLUTION`,
    };
  }

  const parsedEv = SignedEventSchema.safeParse(opts.nostrEvent);
  if (!parsedEv.success || parsedEv.data.kind !== OUTCOME_ATTESTATION_KIND) {
    return {
      ok: false,
      status: 422,
      code: "VALIDATION_FAILED",
      message: `Proposal must be a signed kind ${OUTCOME_ATTESTATION_KIND} Nostr event`,
    };
  }

  const ev = {
    ...parsedEv.data,
    id: parsedEv.data.id.toLowerCase(),
    pubkey: parsedEv.data.pubkey.toLowerCase(),
    sig: parsedEv.data.sig.toLowerCase(),
  };

  if (!verifyEvent(ev)) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Invalid Nostr event signature" };
  }

  const specTag = ev.tags.find((t) => t[0] === "spec_sha256")?.[1];
  if (specTag !== market.specSha256) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Proposal spec_sha256 tag mismatch" };
  }

  const outcomeTag = ev.tags.find((t) => t[0] === "outcome")?.[1];
  if (!outcomeTag || !(OUTCOMES as readonly string[]).includes(outcomeTag)) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Proposal must specify outcome YES, NO, or INVALID" };
  }
  const proposedOutcome = outcomeTag as Outcome;

  const proofUrls = ev.tags
    .filter((t) => t[0] === "proof" && typeof t[1] === "string" && isValidHttpUrl(t[1]))
    .map((t) => t[1]);
  if (proofUrls.length === 0) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Proposal must include at least one valid http(s) proof URL tag" };
  }

  const authorized = market.isDemo || (await isAuthorizedSigner(db, ev.pubkey, opts.allowedSigners));
  if (!authorized) {
    return { ok: false, status: 403, code: "SIGNER_NOT_AUTHORIZED", message: "Pubkey is not an authorized oracle signer" };
  }

  const conflict = await hasSignerConflictOfInterest(db, market.id, ev.pubkey);
  if (conflict) {
    return {
      ok: false,
      status: 403,
      code: "SIGNER_CONFLICT_OF_INTEREST",
      message: "Oracle signers cannot resolve markets they placed bets on",
    };
  }

  const windowSec = opts.challengeWindowSec ?? getChallengeWindowSec(market.isDemo);
  const challengeEndsAt = new Date(now.getTime() + windowSec * 1000);
  const relays = getConfiguredRelays();
  const broadcast =
    opts.broadcastFn ??
    (market.isDemo
      ? async () => [] as string[]
      : (e: VerifiedEvent, r: string[]) => broadcastEventToRelays(e, r));
  const relaysOk = await broadcast(ev as VerifiedEvent, relays);

  const txOut = await db.transaction(async (tx) => {
    const updatedMarkets = await tx
      .update(schema.markets)
      .set({ status: "PROPOSED" })
      .where(
        and(
          eq(schema.markets.id, market.id),
          inArray(schema.markets.status, ["OPEN", "CLOSED", "PENDING_RESOLUTION"]),
        ),
      )
      .returning();

    if (updatedMarkets.length === 0) return null;

    await tx
      .insert(schema.signers)
      .values({ pubkey: ev.pubkey, policy: "platform_signer", active: true })
      .onConflictDoNothing();

    const [proposal] = await tx
      .insert(schema.proposals)
      .values({
        marketId: market.id,
        signerPubkey: ev.pubkey,
        outcome: proposedOutcome,
        proofUrls,
        nostrEvent: ev,
        bondMsat: 0,
        challengeEndsAt,
        status: "ACTIVE",
        createdAt: now,
      })
      .returning();

    await tx
      .insert(schema.nostrEvents)
      .values({
        id: ev.id,
        marketId: market.id,
        kind: OUTCOME_ATTESTATION_KIND,
        event: ev,
        relaysOk,
      })
      .onConflictDoNothing();

    return { proposal, market: updatedMarkets[0] };
  });

  if (!txOut) {
    return { ok: false, status: 409, code: "PROPOSAL_CONFLICT", message: "Another proposal was already submitted" };
  }

  emitMarketPoolUpdate({
    market_id: txOut.market.id,
    pool_yes_msat: txOut.market.poolYesMsat,
    pool_no_msat: txOut.market.poolNoMsat,
    status: txOut.market.status,
    outcome: txOut.market.outcome,
    updated_at: now.toISOString(),
  });

  return { ok: true, proposal: txOut.proposal, market: txOut.market };
}

export type SubmitDisputeResult =
  | {
      ok: true;
      dispute: typeof schema.disputes.$inferSelect;
      bond_invoice: { payment_hash: string; bolt11: string; amount_sats: number; simulated: boolean };
      market: schema.Market;
    }
  | {
      ok: false;
      status: 404 | 409 | 422 | 502;
      code: string;
      message: string;
    };

export async function submitTrackBDispute(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    marketIdOrSlug: string;
    nostrEvent: unknown;
    now?: Date;
    createInvoiceFn?: typeof createLightningInvoice;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
  },
): Promise<SubmitDisputeResult> {
  const mktRows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, opts.marketIdOrSlug), eq(schema.markets.slug, opts.marketIdOrSlug)))
    .limit(1);
  const market = mktRows[0];
  if (!market) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Market not found" };
  }
  if (market.status !== "PROPOSED") {
    return { ok: false, status: 409, code: "MARKET_NOT_PROPOSED", message: `Cannot dispute market in ${market.status} status` };
  }

  const propRows = await db
    .select()
    .from(schema.proposals)
    .where(and(eq(schema.proposals.marketId, market.id), eq(schema.proposals.status, "ACTIVE")))
    .orderBy(desc(schema.proposals.createdAt))
    .limit(1);
  const proposal = propRows[0];
  if (!proposal) {
    return { ok: false, status: 409, code: "NO_ACTIVE_PROPOSAL", message: "No active proposal to dispute" };
  }

  const now = opts.now ?? new Date();
  if (now.getTime() >= proposal.challengeEndsAt.getTime()) {
    return { ok: false, status: 409, code: "CHALLENGE_WINDOW_CLOSED", message: "Challenge window has already expired" };
  }

  const parsedEv = SignedEventSchema.safeParse(opts.nostrEvent);
  if (!parsedEv.success || parsedEv.data.kind !== DISPUTE_EVENT_KIND) {
    return {
      ok: false,
      status: 422,
      code: "VALIDATION_FAILED",
      message: `Dispute must be a signed kind ${DISPUTE_EVENT_KIND} Nostr event`,
    };
  }

  const ev = {
    ...parsedEv.data,
    id: parsedEv.data.id.toLowerCase(),
    pubkey: parsedEv.data.pubkey.toLowerCase(),
    sig: parsedEv.data.sig.toLowerCase(),
  };

  if (!verifyEvent(ev)) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Invalid Nostr dispute signature" };
  }

  const proofUrls = ev.tags
    .filter((t) => t[0] === "proof" && typeof t[1] === "string" && isValidHttpUrl(t[1]))
    .map((t) => t[1]);
  if (proofUrls.length === 0) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Dispute must include at least one valid http(s) proof URL tag" };
  }

  const bondSats = getDisputeBondSats();
  const createInv = opts.createInvoiceFn ?? createLightningInvoice;
  let inv;
  try {
    inv = await createInv({
      amountSats: bondSats,
      memo: `BitPredict Dispute Bond: ${market.slug}`,
      expirySec: 600,
      forceSimulated: market.isDemo,
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: "LIGHTNING_ERROR",
      message: err instanceof Error ? err.message : "Failed to create bond invoice",
    };
  }

  const relays = getConfiguredRelays();
  const broadcast =
    opts.broadcastFn ??
    (market.isDemo
      ? async () => [] as string[]
      : (e: VerifiedEvent, r: string[]) => broadcastEventToRelays(e, r));
  const relaysOk = await broadcast(ev as VerifiedEvent, relays);

  const txOut = await db.transaction(async (tx) => {
    const updatedMarkets = await tx
      .update(schema.markets)
      .set({ status: "DISPUTED" })
      .where(and(eq(schema.markets.id, market.id), eq(schema.markets.status, "PROPOSED")))
      .returning();
    if (updatedMarkets.length === 0) return null;

    await tx
      .update(schema.proposals)
      .set({ status: "DISPUTED" })
      .where(eq(schema.proposals.id, proposal.id));

    await tx
      .insert(schema.users)
      .values({ pubkey: ev.pubkey, isGuest: false })
      .onConflictDoNothing();

    const [dispute] = await tx
      .insert(schema.disputes)
      .values({
        proposalId: proposal.id,
        disputerPubkey: ev.pubkey,
        bondPaymentHash: inv.paymentHash,
        proofUrls,
        nostrEvent: ev,
        status: "OPEN",
        createdAt: now,
      })
      .returning();

    await tx
      .insert(schema.nostrEvents)
      .values({
        id: ev.id,
        marketId: market.id,
        kind: DISPUTE_EVENT_KIND,
        event: ev,
        relaysOk,
      })
      .onConflictDoNothing();

    return { dispute, market: updatedMarkets[0] };
  });

  if (!txOut) {
    return { ok: false, status: 409, code: "DISPUTE_CONFLICT", message: "Proposal is no longer active" };
  }

  emitMarketPoolUpdate({
    market_id: txOut.market.id,
    pool_yes_msat: txOut.market.poolYesMsat,
    pool_no_msat: txOut.market.poolNoMsat,
    status: txOut.market.status,
    outcome: txOut.market.outcome,
    updated_at: now.toISOString(),
  });

  return {
    ok: true,
    dispute: txOut.dispute,
    bond_invoice: {
      payment_hash: inv.paymentHash,
      bolt11: inv.bolt11,
      amount_sats: bondSats,
      simulated: inv.simulated,
    },
    market: txOut.market,
  };
}

export async function finalizeExpiredProposals(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    now?: Date;
    marketId?: string;
    forceFinalizeInDemo?: boolean;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
  } = {},
): Promise<string[]> {
  const now = opts.now ?? new Date();
  const where = opts.marketId
    ? and(eq(schema.markets.status, "PROPOSED"), eq(schema.markets.id, opts.marketId))
    : eq(schema.markets.status, "PROPOSED");

  const proposedMarkets = await db.select().from(schema.markets).where(where);
  const finalizedIds: string[] = [];

  for (const m of proposedMarkets) {
    const propRows = await db
      .select()
      .from(schema.proposals)
      .where(and(eq(schema.proposals.marketId, m.id), eq(schema.proposals.status, "ACTIVE")))
      .orderBy(desc(schema.proposals.createdAt))
      .limit(1);
    const proposal = propRows[0];
    if (!proposal) continue;

    const expired = now.getTime() >= proposal.challengeEndsAt.getTime();
    const force =
      Boolean(opts.forceFinalizeInDemo) &&
      (m.isDemo || process.env.DEMO_MODE !== "false") &&
      opts.marketId === m.id;
    if (!expired && !force) continue;

    const nextStatus = proposal.outcome === "INVALID" ? "VOID" : "RESOLVED";

    const updatedMarket = await db.transaction(async (tx) => {
      const accepted = await tx
        .update(schema.proposals)
        .set({ status: "ACCEPTED" })
        .where(and(eq(schema.proposals.id, proposal.id), eq(schema.proposals.status, "ACTIVE")))
        .returning();
      if (accepted.length === 0) return null;

      await tx
        .update(schema.signers)
        .set({ resolvedCount: sql`${schema.signers.resolvedCount} + 1` })
        .where(eq(schema.signers.pubkey, proposal.signerPubkey));

      const [mkt] = await tx
        .update(schema.markets)
        .set({ status: nextStatus, outcome: proposal.outcome, resolvedAt: now })
        .where(eq(schema.markets.id, m.id))
        .returning();
      return mkt;
    });

    if (!updatedMarket) continue;
    finalizedIds.push(updatedMarket.id);

    emitMarketPoolUpdate({
      market_id: updatedMarket.id,
      pool_yes_msat: updatedMarket.poolYesMsat,
      pool_no_msat: updatedMarket.poolNoMsat,
      status: updatedMarket.status,
      outcome: updatedMarket.outcome,
      updated_at: now.toISOString(),
    });

    if (updatedMarket.poolYesMsat + updatedMarket.poolNoMsat > 0) {
      await settleMarketAndDispatchPayouts(db, updatedMarket.id, {
        now,
        broadcastFn: opts.broadcastFn,
      });
    }
  }

  return finalizedIds;
}

export type RuleDisputeResult =
  | {
      ok: true;
      market: schema.Market;
      dispute: typeof schema.disputes.$inferSelect;
      proposal: typeof schema.proposals.$inferSelect;
    }
  | {
      ok: false;
      status: 403 | 404 | 409 | 422;
      code: string;
      message: string;
    };

export async function ruleOnDispute(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    disputeId: string;
    adminPubkey: string;
    outcome: Outcome;
    now?: Date;
    allowedAdmins?: string[];
    allowDemoAdmin?: boolean;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
  },
): Promise<RuleDisputeResult> {
  const isStrictAdmin = isAuthorizedAdmin(opts.adminPubkey, opts.allowedAdmins);
  if (!isStrictAdmin && !opts.allowDemoAdmin) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Pubkey is not an authorized dispute arbitrator" };
  }
  if (!(OUTCOMES as readonly string[]).includes(opts.outcome)) {
    return { ok: false, status: 422, code: "VALIDATION_FAILED", message: "Outcome must be YES, NO, or INVALID" };
  }

  const dispRows = await db
    .select()
    .from(schema.disputes)
    .where(eq(schema.disputes.id, opts.disputeId))
    .limit(1);
  const dispute = dispRows[0];
  if (!dispute) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Dispute not found" };
  }
  if (dispute.status !== "OPEN") {
    return { ok: false, status: 409, code: "DISPUTE_CLOSED", message: `Dispute is already ${dispute.status}` };
  }

  const propRows = await db
    .select()
    .from(schema.proposals)
    .where(eq(schema.proposals.id, dispute.proposalId))
    .limit(1);
  const proposal = propRows[0];
  if (!proposal) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Proposal not found" };
  }

  const mktRows = await db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, proposal.marketId))
    .limit(1);
  const targetMarket = mktRows[0];
  if (!targetMarket) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Market not found" };
  }
  if (!isStrictAdmin && !(opts.allowDemoAdmin && targetMarket.isDemo)) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Pubkey is not an authorized dispute arbitrator" };
  }

  const now = opts.now ?? new Date();
  const upheld = opts.outcome !== proposal.outcome;
  const bondMsat = getDisputeBondSats() * 1000;
  const nextMarketStatus = opts.outcome === "INVALID" ? "VOID" : "RESOLVED";

  const txOut = await db.transaction(async (tx) => {
    const [updatedDispute] = await tx
      .update(schema.disputes)
      .set({ status: upheld ? "UPHELD" : "REJECTED" })
      .where(and(eq(schema.disputes.id, dispute.id), eq(schema.disputes.status, "OPEN")))
      .returning();
    if (!updatedDispute) return null;

    const [updatedProposal] = await tx
      .update(schema.proposals)
      .set({ status: upheld ? "REJECTED" : "ACCEPTED" })
      .where(eq(schema.proposals.id, proposal.id))
      .returning();

    if (upheld) {
      await tx
        .update(schema.signers)
        .set({ disputesLost: sql`${schema.signers.disputesLost} + 1` })
        .where(eq(schema.signers.pubkey, proposal.signerPubkey));

      await tx
        .insert(schema.payouts)
        .values({
          marketId: proposal.marketId,
          userPubkey: dispute.disputerPubkey,
          kind: "BOND_RETURN",
          amountMsat: bondMsat,
          status: "QUEUED",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.payouts.marketId, schema.payouts.userPubkey, schema.payouts.kind],
          set: {
            amountMsat: sql`${schema.payouts.amountMsat} + ${bondMsat}`,
            status: "QUEUED",
            updatedAt: now,
          },
        });

      await tx.insert(schema.ledgerEntries).values([
        { account: "escrow", amountMsat: bondMsat, refType: "bond", refId: dispute.id, createdAt: now },
        { account: `user:${dispute.disputerPubkey}`, amountMsat: -bondMsat, refType: "bond", refId: dispute.id, createdAt: now },
      ]);
    } else {
      await tx
        .update(schema.signers)
        .set({ resolvedCount: sql`${schema.signers.resolvedCount} + 1` })
        .where(eq(schema.signers.pubkey, proposal.signerPubkey));
    }

    const [updatedMarket] = await tx
      .update(schema.markets)
      .set({ status: nextMarketStatus, outcome: opts.outcome, resolvedAt: now })
      .where(eq(schema.markets.id, proposal.marketId))
      .returning();

    return { updatedDispute, updatedProposal, updatedMarket };
  });

  if (!txOut) {
    return { ok: false, status: 409, code: "DISPUTE_CLOSED", message: "Dispute already ruled" };
  }

  emitMarketPoolUpdate({
    market_id: txOut.updatedMarket.id,
    pool_yes_msat: txOut.updatedMarket.poolYesMsat,
    pool_no_msat: txOut.updatedMarket.poolNoMsat,
    status: txOut.updatedMarket.status,
    outcome: txOut.updatedMarket.outcome,
    updated_at: now.toISOString(),
  });

  let finalMarket = txOut.updatedMarket;
  if (finalMarket.poolYesMsat + finalMarket.poolNoMsat > 0 || upheld) {
    const settled = await settleMarketAndDispatchPayouts(db, finalMarket.id, {
      now,
      broadcastFn: opts.broadcastFn,
    });
    if (settled.ok) {
      finalMarket = settled.market;
    }
  }

  return {
    ok: true,
    market: finalMarket,
    dispute: txOut.updatedDispute,
    proposal: txOut.updatedProposal,
  };
}
