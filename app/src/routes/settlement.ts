import { createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { getOrGenerateEvidenceSummary } from "@/lib/ai/evidence";
import { getCurrentUserFromRequest } from "@/lib/auth/server";
import { db, schema } from "@/lib/db/client";
import { seedDemoWorkspace } from "@/lib/demo/seed";
import { OUTCOMES, type MarketStatus, type Outcome } from "@/lib/domain/constants";
import { getPlatformKeypair } from "@/lib/nostr/keys";
import { finalizeExpiredProposals, ruleOnDispute } from "@/lib/oracle/track-b-repo";
import { resolveTrackAMarket, runOracleTick } from "@/lib/oracle/worker-repo";
import { getBetByIdFromDb, settleBetByPaymentHash } from "@/lib/payments/bet-repo";
import { claimPayoutWithBolt11 } from "@/lib/payments/settlement-repo";

function makeK1(payoutId: string, userPubkey: string): string {
  const secret = process.env.AUTH_SECRET?.trim() || "bitpredict-dev-lnurlw-secret";
  return createHmac("sha256", secret).update(`${payoutId}:${userPubkey}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const settlementRoutes = new Elysia({ name: "bitpredict-settlement", tags: ["Settlement & Ops"] })
  .get(
    "/api/v1/bets/:id",
    async ({ params, set }) => {
      const bet = await getBetByIdFromDb(db, params.id);
      if (!bet) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Bet not found" } };
      }
      set.headers["cache-control"] = "no-store";
      return { bet };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Get bet payment & confirmation status",
        tags: ["Markets & Betting"],
      },
    },
  )
  .post(
    "/api/v1/webhooks/lnbits",
    async ({ request, query, body, set }) => {
      const configuredSecret = process.env.LNBITS_WEBHOOK_SECRET?.trim();
      if (configuredSecret) {
        const headerSecret = request.headers.get("x-webhook-secret");
        if (headerSecret !== configuredSecret && query.secret !== configuredSecret) {
          set.status = 401;
          return { error: { code: "UNAUTHORIZED", message: "Invalid webhook secret" } };
        }
      }

      const b = (body ?? {}) as Record<string, unknown>;
      const paymentHash =
        typeof b.payment_hash === "string"
          ? b.payment_hash.trim()
          : typeof b.checking_id === "string"
            ? b.checking_id.trim()
            : "";

      if (!paymentHash) {
        set.status = 422;
        return { error: { code: "VALIDATION_FAILED", message: "Missing payment_hash" } };
      }

      const settled = await settleBetByPaymentHash(db, { paymentHash });
      if (!settled.ok) {
        set.status = settled.status;
        return { error: { code: settled.code, message: settled.message } };
      }

      return {
        ok: true,
        status: settled.bet.status,
        idempotent: settled.idempotent,
        pool_yes_msat: settled.market.poolYesMsat,
        pool_no_msat: settled.market.poolNoMsat,
      };
    },
    {
      query: t.Object({ secret: t.Optional(t.String()) }),
      body: t.Record(t.String(), t.Any()),
      detail: {
        summary: "LNbits incoming payment confirmation webhook",
        tags: ["Settlement & Ops"],
      },
    },
  )
  .get(
    "/api/v1/oracle/queue",
    async ({ query, set }) => {
      const demoAllowed = process.env.DEMO_MODE !== "false";
      const includeOpen = query.include_open === "true" || demoAllowed;
      const statuses: MarketStatus[] = includeOpen
        ? ["OPEN", "CLOSED", "PENDING_RESOLUTION", "PROPOSED", "DISPUTED"]
        : ["PENDING_RESOLUTION", "PROPOSED", "DISPUTED"];

      const markets = await db
        .select()
        .from(schema.markets)
        .where(inArray(schema.markets.status, statuses))
        .orderBy(desc(schema.markets.createdAt))
        .limit(40);

      const trackBMarkets = markets.filter((m) => m.track === "nostr_oracle");
      const platformPubkey = getPlatformKeypair().pubkey;

      const items = await Promise.all(
        trackBMarkets.map(async (m) => {
          const [evidence, proposals] = await Promise.all([
            getOrGenerateEvidenceSummary(db, m.id),
            db
              .select()
              .from(schema.proposals)
              .where(eq(schema.proposals.marketId, m.id))
              .orderBy(desc(schema.proposals.createdAt))
              .limit(3),
          ]);

          const proposalIds = proposals.map((p) => p.id);
          const disputes =
            proposalIds.length > 0
              ? await db
                  .select()
                  .from(schema.disputes)
                  .where(inArray(schema.disputes.proposalId, proposalIds))
                  .orderBy(desc(schema.disputes.createdAt))
              : [];

          return { market: m, evidence, proposals, disputes };
        }),
      );

      set.headers["cache-control"] = "no-store";
      return { platform_pubkey: platformPubkey, queue: items };
    },
    {
      query: t.Object({ include_open: t.Optional(t.String()) }),
      detail: {
        summary: "List Track B Nostr Oracle Signer queue with AI evidence briefs",
        tags: ["Oracles"],
      },
    },
  )
  .post(
    "/api/v1/oracle/tick",
    async ({ body, set }) => {
      const b = (body ?? {}) as {
        market_id?: string;
        force_demo_resolve?: boolean;
        force_finalize_proposal?: boolean;
      };
      const demoAllowed = process.env.DEMO_MODE !== "false";

      if (demoAllowed && typeof b.market_id === "string" && b.market_id.trim() && b.force_finalize_proposal === true) {
        const finalized = await finalizeExpiredProposals(db, {
          marketId: b.market_id.trim(),
          forceFinalizeInDemo: true,
        });
        if (finalized.length === 0) {
          set.status = 409;
          return { error: { code: "NOT_PROPOSED", message: "No active Track B proposal found to finalize" } };
        }
        return { mode: "demo_finalize_proposal", finalized };
      }

      if (demoAllowed && typeof b.market_id === "string" && b.market_id.trim() && b.force_demo_resolve === true) {
        const res = await resolveTrackAMarket(db, b.market_id.trim(), {
          forceResolveNow: true,
          allowDemoFallback: true,
        });
        if (!res.ok) {
          set.status = res.status === "NOT_FOUND" ? 404 : 409;
          return { error: { code: res.status, message: res.reason } };
        }
        return {
          mode: "demo_force_resolve",
          market: res.market,
          proof: res.proof,
          attestation_event: res.attestation_event,
        };
      }

      const summary = await runOracleTick(db, { allowDemoFallback: demoAllowed });
      return { mode: "tick", summary };
    },
    {
      body: t.Optional(
        t.Object({
          market_id: t.Optional(t.String()),
          force_demo_resolve: t.Optional(t.Boolean()),
          force_finalize_proposal: t.Optional(t.Boolean()),
        }),
      ),
      detail: {
        summary: "Run Track A & Track B oracle worker tick",
        tags: ["Oracles"],
      },
    },
  )
  .post(
    "/api/v1/payouts/:id/claim",
    async ({ request, params, body, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Log in with Nostr before claiming" } };
      }

      const res = await claimPayoutWithBolt11(db, {
        payoutId: params.id,
        userPubkey: user.pubkey,
        bolt11: body?.bolt11,
      });

      if (!res.ok) {
        set.status = res.status;
        return { error: { code: res.code, message: res.message } };
      }

      return { payout: res.payout };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object({
          bolt11: t.Optional(t.String({ maxLength: 1500 })),
        }),
      ),
      detail: {
        summary: "Claim a winning/refund payout with a BOLT11 invoice",
        tags: ["Settlement & Ops"],
      },
    },
  )
  .get(
    "/api/v1/payouts/:id/lnurlw",
    async ({ request, params, query, set }) => {
      const rows = await db.select().from(schema.payouts).where(eq(schema.payouts.id, params.id)).limit(1);
      const payout = rows[0];
      if (!payout) {
        set.status = 404;
        return { status: "ERROR", reason: "Payout not found" };
      }

      if (!["CLAIMABLE", "FAILED", "QUEUED"].includes(payout.status)) {
        set.status = 409;
        return { status: "ERROR", reason: `Payout already ${payout.status}` };
      }

      const expectedK1 = makeK1(payout.id, payout.userPubkey);
      if (query.pr) {
        if (!query.k1 || !safeEqualHex(query.k1, expectedK1)) {
          set.status = 401;
          return { status: "ERROR", reason: "Invalid k1 token" };
        }
        const claimed = await claimPayoutWithBolt11(db, {
          payoutId: payout.id,
          userPubkey: payout.userPubkey,
          bolt11: query.pr,
        });
        if (!claimed.ok) {
          set.status = claimed.status;
          return { status: "ERROR", reason: claimed.message };
        }
        return { status: "OK", preimage: claimed.payout.preimage };
      }

      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/+$/, "");
      const satsMsat = Math.floor(payout.amountMsat / 1000) * 1000;
      set.headers["cache-control"] = "no-store";
      return {
        tag: "withdrawRequest",
        callback: `${baseUrl}/api/v1/payouts/${encodeURIComponent(payout.id)}/lnurlw`,
        k1: expectedK1,
        defaultDescription: `BitPredict ${payout.kind} payout`,
        minWithdrawable: satsMsat,
        maxWithdrawable: satsMsat,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        pr: t.Optional(t.String()),
        k1: t.Optional(t.String()),
      }),
      detail: {
        summary: "LUD-03 LNURL-withdraw metadata & callback",
        tags: ["Settlement & Ops"],
      },
    },
  )
  .post(
    "/api/v1/admin/disputes/:id/rule",
    async ({ request, params, body, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Log in with Nostr to arbitrate disputes" } };
      }

      const res = await ruleOnDispute(db, {
        disputeId: params.id,
        adminPubkey: user.pubkey,
        outcome: body.outcome as Outcome,
      });

      if (!res.ok) {
        set.status = res.status;
        return { error: { code: res.code, message: res.message } };
      }

      return {
        market: res.market,
        dispute: res.dispute,
        proposal: res.proposal,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        outcome: t.Union(OUTCOMES.map((o) => t.Literal(o))),
      }),
      detail: {
        summary: "Admin arbitration ruling on disputed Track B market",
        tags: ["Oracles"],
      },
    },
  )
  .post(
    "/api/v1/demo/seed",
    async ({ set }) => {
      if (process.env.DEMO_MODE === "false") {
        set.status = 403;
        return { error: { code: "FORBIDDEN", message: "Demo mode seeding is disabled" } };
      }
      const result = await seedDemoWorkspace(db);
      set.headers["cache-control"] = "no-store";
      return { ok: true, ...result };
    },
    {
      detail: {
        summary: "Idempotent showcase demo seeder (3 users, 6 markets)",
        tags: ["Settlement & Ops"],
      },
    },
  );
