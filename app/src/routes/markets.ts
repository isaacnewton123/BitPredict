import { Elysia, t } from "elysia";
import { compileMarketPrompt } from "@/lib/ai/compiler";
import { getOrGenerateMarketInsight } from "@/lib/ai/insight";
import { validateFullMarketSpec } from "@/lib/ai/validate-spec";
import { getCurrentUserFromRequest } from "@/lib/auth/server";
import { db } from "@/lib/db/client";
import { getCategoryBySlug } from "@/lib/domain/categories";
import {
  CATEGORIES,
  RESOLUTION_TRACKS,
  SIDES,
  type Category,
  type MarketStatus,
  type ResolutionTrack,
  type Side,
} from "@/lib/domain/constants";
import { computeSpecSha256 } from "@/lib/domain/spec-hash";
import { createMarketDraft, recordRejectedAiRun, updateMarketDraft } from "@/lib/markets/draft-repo";
import {
  LISTED_MARKET_STATUSES,
  type MarketSort,
  publishMarketDraft,
} from "@/lib/markets/publish-repo";
import {
  getMarketActivity,
  getMarketByIdOrSlug,
  getMarketEvents,
  listMarkets,
} from "@/lib/markets/queries";
import { submitTrackBDispute, submitTrackBProposal } from "@/lib/oracle/track-b-repo";
import { getMarketProofBundleFromDb } from "@/lib/oracle/worker-repo";
import { placeBetOrder } from "@/lib/payments/bet-repo";
import { subscribeMarketPool, type MarketPoolUpdate } from "@/lib/payments/events";

function parseCategoryParam(raw?: string): Category | undefined {
  if (!raw) return undefined;
  if ((CATEGORIES as readonly string[]).includes(raw)) return raw as Category;
  return getCategoryBySlug(raw)?.id;
}

export const marketRoutes = new Elysia({ name: "bitpredict-markets", tags: ["Markets & Betting"] })
  .get(
    "/api/v1/markets",
    async ({ query, set }) => {
      const category = parseCategoryParam(query.category);
      const statusRaw = query.status?.toUpperCase();
      const status =
        statusRaw && (LISTED_MARKET_STATUSES as readonly string[]).includes(statusRaw)
          ? (statusRaw as MarketStatus)
          : undefined;
      const track =
        query.track && (RESOLUTION_TRACKS as readonly string[]).includes(query.track)
          ? (query.track as ResolutionTrack)
          : undefined;
      const sort: MarketSort =
        query.sort === "trending" || query.sort === "closing" ? query.sort : "new";
      const limitNum = Number(query.limit ?? 60);
      const limit = Number.isFinite(limitNum) ? Math.min(100, Math.max(1, Math.floor(limitNum))) : 60;

      const markets = await listMarkets({ category, status, track, sort, limit });
      set.headers["cache-control"] = "no-store";
      return { markets };
    },
    {
      query: t.Object({
        category: t.Optional(t.String()),
        status: t.Optional(t.String()),
        track: t.Optional(t.String()),
        sort: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        summary: "List live prediction markets",
        description: "Filter by category, lifecycle status, oracle track, and sort order.",
        tags: ["Markets & Betting"],
      },
    },
  )
  .post(
    "/api/v1/markets/draft",
    async ({ request, body, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Log in with Nostr before creating a market" } };
      }

      const compiled = await compileMarketPrompt({
        prompt: body.prompt,
        timezone: body.timezone,
      });

      if (!compiled.ok) {
        await recordRejectedAiRun(db, {
          prompt: body.prompt,
          timezone: body.timezone,
          compiled,
        }).catch(() => undefined);

        set.status = 422;
        return {
          error: {
            code: compiled.code,
            message: compiled.message,
            details: compiled.errors,
          },
        };
      }

      let compiledToSave = compiled;
      const requestedImageUrl = body.image_url?.trim();
      if (requestedImageUrl) {
        const revalidated = validateFullMarketSpec({
          ...compiled.spec,
          image_url: requestedImageUrl,
        });
        if (!revalidated.ok) {
          set.status = 422;
          return {
            error: {
              code: "VALIDATION_FAILED",
              message: revalidated.errors[0] ?? "Invalid cover image URL",
              details: revalidated.errors,
            },
          };
        }
        compiledToSave = {
          ...compiled,
          spec: revalidated.spec,
          specSha256: revalidated.specSha256,
          auditUrl: revalidated.auditUrl ?? compiled.auditUrl,
          warnings: revalidated.warnings,
        };
      }

      const draft = await createMarketDraft(db, {
        creatorPubkey: user.pubkey,
        prompt: body.prompt,
        timezone: body.timezone,
        compiled: compiledToSave,
      });

      set.status = 201;
      return draft;
    },
    {
      body: t.Object({
        prompt: t.String({ minLength: 1 }),
        timezone: t.Optional(t.String({ maxLength: 80 })),
        image_url: t.Optional(t.String({ maxLength: 500 })),
      }),
      detail: {
        summary: "AI Prompt-to-Oracle draft generator",
        description:
          "Compiles a 1-sentence question into a deterministic MarketSpec validated against the provider allowlist.",
        tags: ["AI Studio"],
      },
    },
  )
  .put(
    "/api/v1/markets/draft/:id",
    async ({ request, params, body, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Not logged in" } };
      }

      const updated = await updateMarketDraft(db, {
        draftId: params.id,
        creatorPubkey: user.pubkey,
        rawSpec: body.spec,
      });

      if (!updated.ok) {
        set.status = updated.status;
        return {
          error: {
            code: updated.code,
            message: updated.message,
            details: updated.errors ?? [],
          },
        };
      }

      return {
        draft_id: updated.draft_id,
        slug: updated.slug,
        spec: updated.spec,
        spec_sha256: updated.spec_sha256,
        audit_url: updated.audit_url,
        assumptions: updated.assumptions,
        warnings: updated.warnings,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ spec: t.Any() }),
      detail: {
        summary: "Update & re-validate a draft MarketSpec",
        tags: ["AI Studio"],
      },
    },
  )
  .post(
    "/api/v1/markets",
    async ({ request, body, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Log in with Nostr before publishing a market" } };
      }

      const result = await publishMarketDraft(db, {
        draftId: body.draft_id,
        creatorPubkey: user.pubkey,
        creatorSignatureEvent: body.creator_signature_event,
      });

      if (!result.ok) {
        set.status = result.status;
        return {
          error: {
            code: result.code,
            message: result.message,
            details: result.errors ?? [],
          },
        };
      }

      set.status = 201;
      return { market: result.market, nostr: result.nostr };
    },
    {
      body: t.Object({
        draft_id: t.String({ minLength: 1 }),
        creator_signature_event: t.Optional(t.Any()),
      }),
      detail: {
        summary: "Publish a draft market live & broadcast Nostr events",
        description:
          "Transitions a DRAFT market to OPEN and broadcasts kind 30078 (NIP-78 spec) + kind 1 social note.",
        tags: ["Markets & Betting"],
      },
    },
  )
  .get(
    "/api/v1/markets/:id",
    async ({ request, params, set }) => {
      const market = await getMarketByIdOrSlug(params.id);
      if (!market) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Market not found" } };
      }

      if (market.status === "DRAFT") {
        const user = await getCurrentUserFromRequest(request);
        if (!user || user.pubkey !== market.creatorPubkey) {
          set.status = 404;
          return { error: { code: "NOT_FOUND", message: "Market not found" } };
        }
      }

      const [events, activity] = await Promise.all([
        getMarketEvents(market.id),
        getMarketActivity(market),
      ]);
      const computed = computeSpecSha256(market.spec);
      set.headers["cache-control"] = "no-store";
      return {
        market,
        nostr_events: events,
        recent_trades: activity.recent_trades,
        probability_history: activity.probability_history,
        spec_verification: {
          computed_sha256: computed,
          committed_sha256: market.specSha256,
          verified: computed === market.specSha256,
        },
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Get market details, trade history, probability timeline & SHA-256 verification",
        tags: ["Markets & Betting"],
      },
    },
  )
  .get(
    "/api/v1/markets/:id/insight",
    async ({ request, params, set }) => {
      const market = await getMarketByIdOrSlug(params.id);
      if (!market) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Market not found" } };
      }
      if (market.status === "DRAFT") {
        const user = await getCurrentUserFromRequest(request);
        if (!user || user.pubkey !== market.creatorPubkey) {
          set.status = 404;
          return { error: { code: "NOT_FOUND", message: "Market not found" } };
        }
      }

      const insight = await getOrGenerateMarketInsight(db, market.id);
      if (!insight) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Insight unavailable" } };
      }

      set.headers["cache-control"] = "no-store";
      return {
        market_id: market.id,
        slug: market.slug,
        insight,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Get cached non-binding AI Market Insight",
        tags: ["AI Studio"],
      },
    },
  )
  .post(
    "/api/v1/markets/:id/bets",
    async ({ request, params, body, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Log in with Nostr before placing a bet" } };
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
      const secret = process.env.LNBITS_WEBHOOK_SECRET?.trim();
      const webhookUrl =
        appUrl && process.env.LNBITS_URL?.trim()
          ? `${appUrl}/api/v1/webhooks/lnbits${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`
          : undefined;

      const result = await placeBetOrder(db, {
        marketIdOrSlug: params.id,
        userPubkey: user.pubkey,
        side: body.side as Side,
        amountSats: body.amount_sats,
        webhookUrl,
      });

      if (!result.ok) {
        set.status = result.status;
        return { error: { code: result.code, message: result.message } };
      }

      set.status = 201;
      return result;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        side: t.Union(SIDES.map((s) => t.Literal(s))),
        amount_sats: t.Integer({ minimum: 1 }),
      }),
      detail: {
        summary: "Create a Lightning bet order (BOLT11 invoice)",
        tags: ["Markets & Betting"],
      },
    },
  )
  .get(
    "/api/v1/markets/:id/proof",
    async ({ params, set }) => {
      const bundle = await getMarketProofBundleFromDb(db, params.id);
      if (!bundle) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Market not found" } };
      }

      set.headers["cache-control"] = "no-store";
      return {
        market_id: bundle.market.id,
        slug: bundle.market.slug,
        status: bundle.market.status,
        track: bundle.market.track,
        outcome: bundle.market.outcome,
        resolved_at: bundle.market.resolvedAt,
        proofs: bundle.proofs,
        attestation_event: bundle.attestation_event,
        proposals: bundle.proposals,
        disputes: bundle.disputes,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Get raw oracle proofs, kind 30079 attestation & disputes",
        tags: ["Oracles"],
      },
    },
  )
  .post(
    "/api/v1/markets/:id/proposals",
    async ({ params, body, set }) => {
      const res = await submitTrackBProposal(db, {
        marketIdOrSlug: params.id,
        nostrEvent: body.nostr_event,
        forceReadyInDemo: body.force_ready_in_demo,
      });

      if (!res.ok) {
        set.status = res.status;
        return { error: { code: res.code, message: res.message } };
      }

      set.status = 201;
      return { proposal: res.proposal, market: res.market };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        nostr_event: t.Any(),
        force_ready_in_demo: t.Optional(t.Boolean()),
      }),
      detail: {
        summary: "Submit Track B Nostr Oracle outcome proposal (Kind 30079)",
        tags: ["Oracles"],
      },
    },
  )
  .post(
    "/api/v1/markets/:id/disputes",
    async ({ params, body, set }) => {
      const res = await submitTrackBDispute(db, {
        marketIdOrSlug: params.id,
        nostrEvent: body.nostr_event,
      });

      if (!res.ok) {
        set.status = res.status;
        return { error: { code: res.code, message: res.message } };
      }

      set.status = 201;
      return {
        dispute: res.dispute,
        bond_invoice: res.bond_invoice,
        market: res.market,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        nostr_event: t.Any(),
      }),
      detail: {
        summary: "Challenge active Track B proposal with bond (Kind 30080)",
        tags: ["Oracles"],
      },
    },
  )
  .get(
    "/api/v1/markets/:id/stream",
    async ({ request, params, set }) => {
      const market = await getMarketByIdOrSlug(params.id);
      if (!market) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Market not found" } };
      }

      const encoder = new TextEncoder();
      let cleanup: (() => void) | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (payload: MarketPoolUpdate) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          };

          send({
            market_id: market.id,
            pool_yes_msat: market.poolYesMsat,
            pool_no_msat: market.poolNoMsat,
            status: market.status,
            outcome: market.outcome,
            updated_at: new Date().toISOString(),
          });

          const unsubscribe = subscribeMarketPool(market.id, (update) => {
            try {
              send(update);
            } catch {
              // ignore closed stream
            }
          });

          const keepalive = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": keepalive\n\n"));
            } catch {
              // ignore closed stream
            }
          }, 20_000);

          cleanup = () => {
            clearInterval(keepalive);
            unsubscribe();
          };

          request.signal.addEventListener("abort", () => {
            cleanup?.();
            try {
              controller.close();
            } catch {
              // ignore
            }
          });
        },
        cancel() {
          cleanup?.();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Subscribe to real-time market pool updates (SSE)",
        tags: ["Markets & Betting"],
      },
    },
  );
