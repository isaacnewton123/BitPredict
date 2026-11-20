import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { VerifiedEvent } from "nostr-tools/pure";
import * as schema from "@/lib/db/schema";
import { canonicalizeJson } from "@/lib/domain/canonical-json";
import type { FetchLike, MarketStatus } from "@/lib/domain/constants";
import { type AutoApiOracleConfig, isAutoApiConfig } from "@/lib/domain/market-spec";
import { sha256Hex } from "@/lib/domain/spec-hash";
import {
  buildOutcomeAttestationEvent,
  OUTCOME_ATTESTATION_KIND,
} from "@/lib/nostr/events";
import { getPlatformKeypair, getPlatformOracleKeypair } from "@/lib/nostr/keys";
import { broadcastEventToRelays, getConfiguredRelays } from "@/lib/nostr/relay";
import { emitMarketPoolUpdate } from "@/lib/payments/events";
import type {
  payLightningInvoice,
  requestInvoiceFromLightningAddress,
} from "@/lib/payments/lnbits";
import { settleMarketAndDispatchPayouts } from "@/lib/payments/settlement-repo";
import { evaluateOracleCondition, extractValueAtPath } from "./evaluator";
import { validateAutoApiAgainstRegistry } from "./registry";
import { finalizeExpiredProposals } from "./track-b-repo";

const VOID_TIMEOUT_MS = 24 * 3_600_000;

function buildDemoFallbackBody(config: AutoApiOracleConfig, now: Date): unknown {
  const numThreshold = Number(config.condition.threshold);
  const base = Number.isFinite(numThreshold) ? numThreshold : 100;

  switch (config.provider) {
    case "open-meteo":
      return {
        latitude: config.params.latitude ?? 38.9072,
        longitude: config.params.longitude ?? -77.0369,
        daily: {
          time: [String(config.params.start_date ?? now.toISOString().slice(0, 10))],
          [String(config.params.daily ?? "temperature_2m_max")]: [Number((base + 0.4).toFixed(1))],
        },
        _demo_fallback: true,
      };
    case "binance":
      return [
        [
          now.getTime() - 60_000,
          String(base),
          String(base + 250),
          String(Math.max(0, base - 100)),
          String(base + 150),
          "12.345",
        ],
      ];
    case "mempool":
      return config.params.endpoint === "v1/fees/recommended"
        ? { fastestFee: base + 2, halfHourFee: base, hourFee: Math.max(1, base - 2) }
        : base + 10;
    case "coingecko": {
      const id = String(config.params.ids ?? "bitcoin");
      const cur = String(config.params.vs_currencies ?? "usd");
      return { [id]: { [cur]: base + 125 } };
    }
    case "frankfurter": {
      const to = String(config.params.to ?? "EUR");
      return {
        amount: 1.0,
        base: String(config.params.from ?? "USD"),
        date: String(config.params.date ?? now.toISOString().slice(0, 10)),
        rates: { [to]: Number((base + 0.01).toFixed(4)) },
      };
    }
    case "github":
      return {
        stargazers_count: base + 50,
        forks_count: base + 10,
        open_issues_count: Math.max(0, base - 1),
      };
    case "thesportsdb":
      return { events: [{ intHomeScore: "2", intAwayScore: "1", strStatus: "Match Finished" }] };
    case "opendota":
      return { radiant_win: true, duration: 2400 };
  }
}

export type ResolveTrackAResult =
  | {
      ok: true;
      market: schema.Market;
      proof: typeof schema.oracleProofs.$inferSelect;
      attestation_event: VerifiedEvent;
    }
  | {
      ok: false;
      status: MarketStatus | "NOT_FOUND";
      reason: string;
    };

export async function resolveTrackAMarket(
  db: LibSQLDatabase<typeof schema>,
  marketIdOrSlug: string,
  opts: {
    now?: Date;
    forceResolveNow?: boolean;
    fetchFn?: FetchLike;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
    oracleSecretKey?: Uint8Array;
    platformSecretKey?: Uint8Array;
    platformPubkey?: string;
    allowDemoFallback?: boolean;
    requestInvoiceFn?: typeof requestInvoiceFromLightningAddress;
    payInvoiceFn?: typeof payLightningInvoice;
  } = {},
): Promise<ResolveTrackAResult> {
  const rows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, marketIdOrSlug), eq(schema.markets.slug, marketIdOrSlug)))
    .limit(1);

  const market = rows[0];
  if (!market) {
    return { ok: false, status: "NOT_FOUND", reason: "Market not found" };
  }
  if (market.track !== "auto_api" || !isAutoApiConfig(market.spec.oracle_config)) {
    return { ok: false, status: market.status, reason: "Market is not Track A auto_api" };
  }
  if (["RESOLVED", "VOID", "SETTLING", "SETTLED"].includes(market.status)) {
    return { ok: false, status: market.status, reason: `Market already ${market.status}` };
  }

  const now = opts.now ?? new Date();
  if (!opts.forceResolveNow && now.getTime() < market.resolveAfter.getTime()) {
    return { ok: false, status: market.status, reason: "resolve_after_utc has not been reached" };
  }

  const oracleConfig = market.spec.oracle_config;
  const reg = validateAutoApiAgainstRegistry(oracleConfig);
  if (!reg.ok) {
    return { ok: false, status: market.status, reason: reg.errors[0] ?? "Registry check failed" };
  }

  if (market.status === "OPEN" || market.status === "CLOSED") {
    await db
      .update(schema.markets)
      .set({ status: "RESOLVING" })
      .where(eq(schema.markets.id, market.id));
  }

  let httpStatus: number | null = null;
  let body: unknown = null;
  let fetchError: string | null = null;

  const fetchImpl = opts.fetchFn ?? fetch;
  try {
    const res = await fetchImpl(reg.auditUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "BitPredict-Oracle/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = res.status;
    if (!res.ok) {
      fetchError = `Upstream API HTTP ${res.status}`;
    } else {
      body = (await res.json()) as unknown;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Network error";
  }

  let extracted = body !== null ? extractValueAtPath(body, oracleConfig.value_path) : null;

  if (
    (fetchError || extracted === null) &&
    opts.allowDemoFallback &&
    !opts.fetchFn
  ) {
    body = buildDemoFallbackBody(oracleConfig, now);
    httpStatus = httpStatus ?? 200;
    fetchError = null;
    extracted = extractValueAtPath(body, oracleConfig.value_path);
  }

  if (fetchError || extracted === null) {
    const reason = fetchError ?? `Value missing at path ${oracleConfig.value_path}`;
    const bodySha256 = body !== null ? sha256Hex(canonicalizeJson(body)) : null;

    await db.insert(schema.oracleProofs).values({
      marketId: market.id,
      provider: oracleConfig.provider,
      url: reg.auditUrl,
      httpStatus,
      body: body ?? { error: reason },
      bodySha256,
      value: null,
      fetchedAt: now,
    });

    const overdueMs = now.getTime() - market.resolveAfter.getTime();
    if (!opts.forceResolveNow && overdueMs >= VOID_TIMEOUT_MS) {
      const [voided] = await db
        .update(schema.markets)
        .set({ status: "VOID", outcome: "INVALID", resolvedAt: now })
        .where(eq(schema.markets.id, market.id))
        .returning();

      emitMarketPoolUpdate({
        market_id: voided.id,
        pool_yes_msat: voided.poolYesMsat,
        pool_no_msat: voided.poolNoMsat,
        status: voided.status,
        outcome: voided.outcome,
        updated_at: now.toISOString(),
      });
      if (voided.poolYesMsat + voided.poolNoMsat > 0) {
        await settleMarketAndDispatchPayouts(db, voided.id, { now, broadcastFn: opts.broadcastFn });
      }
      return { ok: false, status: "VOID", reason: `${reason} (voided after 24h timeout)` };
    }

    return { ok: false, status: "RESOLVING", reason };
  }

  const outcome = evaluateOracleCondition(extracted, oracleConfig.condition);
  const bodySha256 = sha256Hex(canonicalizeJson(body));
  const platformPubkey = opts.platformPubkey ?? getPlatformKeypair().pubkey;
  const oracleSecretKey = opts.oracleSecretKey ?? getPlatformOracleKeypair().secretKey;

  const attestationEvent = buildOutcomeAttestationEvent({
    slug: market.slug,
    marketNoteId: market.nostrNoteId,
    platformPubkey,
    outcome,
    specSha256: market.specSha256,
    proofUrl: reg.auditUrl,
    proofSha256: bodySha256,
    track: "auto_api",
    summary: `Resolved ${outcome}: ${oracleConfig.value_path} = ${String(extracted)} (${oracleConfig.condition.operator} ${String(oracleConfig.condition.threshold)}).`,
    createdAtSec: Math.floor(now.getTime() / 1000),
    secretKey: oracleSecretKey,
  });

  const relays = getConfiguredRelays();
  const broadcast =
    opts.broadcastFn ??
    (market.isDemo
      ? async () => [] as string[]
      : (ev: VerifiedEvent, r: string[]) => broadcastEventToRelays(ev, r));
  const relaysOk = await broadcast(attestationEvent, relays);

  const txResult = await db.transaction(async (tx) => {
    const [proof] = await tx
      .insert(schema.oracleProofs)
      .values({
        marketId: market.id,
        provider: oracleConfig.provider,
        url: reg.auditUrl,
        httpStatus,
        body,
        bodySha256,
        value: String(extracted),
        fetchedAt: now,
      })
      .returning();

    const [updatedMarket] = await tx
      .update(schema.markets)
      .set({
        status: "RESOLVED",
        outcome,
        resolvedAt: now,
      })
      .where(eq(schema.markets.id, market.id))
      .returning();

    await tx
      .insert(schema.nostrEvents)
      .values({
        id: attestationEvent.id,
        marketId: market.id,
        kind: OUTCOME_ATTESTATION_KIND,
        event: attestationEvent,
        relaysOk,
      })
      .onConflictDoNothing();

    return { updatedMarket, proof };
  });

  emitMarketPoolUpdate({
    market_id: txResult.updatedMarket.id,
    pool_yes_msat: txResult.updatedMarket.poolYesMsat,
    pool_no_msat: txResult.updatedMarket.poolNoMsat,
    status: txResult.updatedMarket.status,
    outcome: txResult.updatedMarket.outcome,
    updated_at: now.toISOString(),
  });

  let finalMarket = txResult.updatedMarket;
  if (finalMarket.poolYesMsat + finalMarket.poolNoMsat > 0) {
    const settled = await settleMarketAndDispatchPayouts(db, finalMarket.id, {
      now,
      broadcastFn: opts.broadcastFn,
      platformSecretKey: opts.platformSecretKey,
      requestInvoiceFn: opts.requestInvoiceFn,
      payInvoiceFn: opts.payInvoiceFn,
    });
    if (settled.ok) {
      finalMarket = settled.market;
    }
  }

  return {
    ok: true,
    market: finalMarket,
    proof: txResult.proof,
    attestation_event: attestationEvent,
  };
}

export interface OracleTickSummary {
  closed_count: number;
  pending_track_b_count: number;
  resolved_track_a: string[];
  voided_track_a: string[];
  retrying_track_a: string[];
}

export async function runOracleTick(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    now?: Date;
    fetchFn?: FetchLike;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
    oracleSecretKey?: Uint8Array;
    platformSecretKey?: Uint8Array;
    platformPubkey?: string;
    allowDemoFallback?: boolean;
    requestInvoiceFn?: typeof requestInvoiceFromLightningAddress;
    payInvoiceFn?: typeof payLightningInvoice;
  } = {},
): Promise<OracleTickSummary> {
  const now = opts.now ?? new Date();

  const closedMarkets = await db
    .update(schema.markets)
    .set({ status: "CLOSED" })
    .where(and(eq(schema.markets.status, "OPEN"), lte(schema.markets.bettingCutoff, now)))
    .returning();

  for (const m of closedMarkets) {
    emitMarketPoolUpdate({
      market_id: m.id,
      pool_yes_msat: m.poolYesMsat,
      pool_no_msat: m.poolNoMsat,
      status: m.status,
      outcome: m.outcome,
      updated_at: now.toISOString(),
    });
  }

  const pendingTrackB = await db
    .update(schema.markets)
    .set({ status: "PENDING_RESOLUTION" })
    .where(
      and(
        eq(schema.markets.track, "nostr_oracle"),
        inArray(schema.markets.status, ["OPEN", "CLOSED"]),
        lte(schema.markets.resolveAfter, now),
      ),
    )
    .returning();

  for (const m of pendingTrackB) {
    emitMarketPoolUpdate({
      market_id: m.id,
      pool_yes_msat: m.poolYesMsat,
      pool_no_msat: m.poolNoMsat,
      status: m.status,
      outcome: m.outcome,
      updated_at: now.toISOString(),
    });
  }

  const dueTrackA = await db
    .select()
    .from(schema.markets)
    .where(
      and(
        eq(schema.markets.track, "auto_api"),
        inArray(schema.markets.status, ["CLOSED", "RESOLVING"]),
        lte(schema.markets.resolveAfter, now),
      ),
    );

  const resolvedTrackA: string[] = [];
  const voidedTrackA: string[] = [];
  const retryingTrackA: string[] = [];

  for (const m of dueTrackA) {
    const res = await resolveTrackAMarket(db, m.id, {
      ...opts,
      allowDemoFallback: Boolean(opts.allowDemoFallback || m.isDemo),
      now,
    });
    if (res.ok) {
      resolvedTrackA.push(m.id);
    } else if (res.status === "VOID") {
      voidedTrackA.push(m.id);
    } else {
      retryingTrackA.push(m.id);
    }
  }

  await finalizeExpiredProposals(db, { now, broadcastFn: opts.broadcastFn });

  // Also settle any RESOLVED/VOID/SETTLING markets that have bets or pending payouts
  const settleQueue = await db
    .select()
    .from(schema.markets)
    .where(inArray(schema.markets.status, ["RESOLVED", "VOID", "SETTLING"]));

  for (const m of settleQueue) {
    if (m.poolYesMsat + m.poolNoMsat > 0) {
      await settleMarketAndDispatchPayouts(db, m.id, { now, broadcastFn: opts.broadcastFn });
    }
  }

  return {
    closed_count: closedMarkets.length,
    pending_track_b_count: pendingTrackB.length,
    resolved_track_a: resolvedTrackA,
    voided_track_a: voidedTrackA,
    retrying_track_a: retryingTrackA,
  };
}

export async function getMarketProofBundleFromDb(
  db: LibSQLDatabase<typeof schema>,
  marketIdOrSlug: string,
) {
  const mktRows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, marketIdOrSlug), eq(schema.markets.slug, marketIdOrSlug)))
    .limit(1);
  const market = mktRows[0];
  if (!market) return null;

  const proofs = await db
    .select()
    .from(schema.oracleProofs)
    .where(eq(schema.oracleProofs.marketId, market.id))
    .orderBy(desc(schema.oracleProofs.fetchedAt))
    .limit(5);

  const attRows = await db
    .select()
    .from(schema.nostrEvents)
    .where(
      and(
        eq(schema.nostrEvents.marketId, market.id),
        eq(schema.nostrEvents.kind, OUTCOME_ATTESTATION_KIND),
      ),
    )
    .orderBy(desc(schema.nostrEvents.createdAt))
    .limit(1);

  const propRows = await db
    .select()
    .from(schema.proposals)
    .where(eq(schema.proposals.marketId, market.id))
    .orderBy(desc(schema.proposals.createdAt))
    .limit(5);

  const proposalIds = propRows.map((p) => p.id);
  const dispRows =
    proposalIds.length > 0
      ? await db
          .select()
          .from(schema.disputes)
          .where(inArray(schema.disputes.proposalId, proposalIds))
          .orderBy(desc(schema.disputes.createdAt))
      : [];

  return {
    market,
    proofs,
    attestation_event: attRows[0] ?? null,
    proposals: propRows,
    disputes: dispRows,
  };
}
