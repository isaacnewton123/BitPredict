import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as nip19 from "nostr-tools/nip19";
import { getPublicKey, verifyEvent, type VerifiedEvent } from "nostr-tools/pure";
import { z } from "zod";
import { validateFullMarketSpec } from "@/lib/ai/validate-spec";
import * as schema from "@/lib/db/schema";
import type { Category, MarketStatus, ResolutionTrack } from "@/lib/domain/constants";
import {
  buildMarketAnnouncementEvent,
  buildMarketSpecEvent,
  encodeMarketPointers,
} from "@/lib/nostr/events";
import { getPlatformKeypair } from "@/lib/nostr/keys";
import { broadcastEventToRelays, getConfiguredRelays } from "@/lib/nostr/relay";

export const LISTED_MARKET_STATUSES: readonly MarketStatus[] = [
  "OPEN",
  "CLOSED",
  "RESOLVING",
  "PENDING_RESOLUTION",
  "PROPOSED",
  "DISPUTED",
  "RESOLVED",
  "SETTLING",
  "SETTLED",
];

export type MarketSort = "new" | "trending" | "closing";

export interface QueryMarketsOptions {
  category?: Category;
  status?: MarketStatus;
  track?: ResolutionTrack;
  mode?: "all" | "live" | "demo";
  sort?: MarketSort;
  limit?: number;
}

export async function queryMarkets(
  db: LibSQLDatabase<typeof schema>,
  opts: QueryMarketsOptions = {},
) {
  const conditions = [];

  if (opts.status && LISTED_MARKET_STATUSES.includes(opts.status)) {
    conditions.push(eq(schema.markets.status, opts.status));
  } else {
    conditions.push(inArray(schema.markets.status, [...LISTED_MARKET_STATUSES]));
  }

  if (opts.category) {
    conditions.push(eq(schema.markets.category, opts.category));
  }
  if (opts.track) {
    conditions.push(eq(schema.markets.track, opts.track));
  }
  if (opts.mode === "live") {
    conditions.push(eq(schema.markets.isDemo, false));
  } else if (opts.mode === "demo") {
    conditions.push(eq(schema.markets.isDemo, true));
  }

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const orderBy =
    opts.sort === "trending"
      ? [
          desc(sql`${schema.markets.poolYesMsat} + ${schema.markets.poolNoMsat}`),
          desc(schema.markets.createdAt),
        ]
      : opts.sort === "closing"
        ? [
            asc(sql`case when ${schema.markets.status} = 'OPEN' then 0 else 1 end`),
            asc(schema.markets.bettingCutoff),
          ]
        : [desc(schema.markets.createdAt)];

  return db
    .select()
    .from(schema.markets)
    .where(where)
    .orderBy(...orderBy)
    .limit(opts.limit ?? 60);
}

export async function getMarketByIdOrSlugFromDb(
  db: LibSQLDatabase<typeof schema>,
  idOrSlug: string,
) {
  const rows = await db
    .select()
    .from(schema.markets)
    .where(or(eq(schema.markets.id, idOrSlug), eq(schema.markets.slug, idOrSlug)))
    .limit(1);
  return rows[0];
}

export async function getMarketEventsFromDb(
  db: LibSQLDatabase<typeof schema>,
  marketId: string,
) {
  return db
    .select()
    .from(schema.nostrEvents)
    .where(eq(schema.nostrEvents.marketId, marketId))
    .orderBy(desc(schema.nostrEvents.kind), asc(schema.nostrEvents.createdAt));
}

export interface MarketProbabilityPoint {
  t: string;
  yes_pct: number;
  no_pct: number;
  pool_sats: number;
}

export interface MarketRecentTrade {
  id: string;
  side: "YES" | "NO";
  amount_sats: number;
  trader_label: string;
  timestamp: string;
  yes_pct_after: number;
  pool_total_sats_after: number;
}

function formatTraderLabel(pubkeyHex: string): string {
  try {
    const npub = nip19.npubEncode(pubkeyHex);
    return `${npub.slice(0, 10)}...${npub.slice(-4)}`;
  } catch {
    return `${pubkeyHex.slice(0, 8)}...`;
  }
}

export async function getMarketActivityFromDb(
  db: LibSQLDatabase<typeof schema>,
  market: schema.Market,
): Promise<{
  recent_trades: MarketRecentTrade[];
  probability_history: MarketProbabilityPoint[];
}> {
  const confirmedBets = await db
    .select()
    .from(schema.bets)
    .where(and(eq(schema.bets.marketId, market.id), eq(schema.bets.status, "CONFIRMED")))
    .orderBy(asc(schema.bets.paidAt), asc(schema.bets.createdAt))
    .limit(200);

  let yesMsat = 0;
  let noMsat = 0;

  const probabilityHistory: MarketProbabilityPoint[] = [
    {
      t: market.createdAt.toISOString(),
      yes_pct: 50,
      no_pct: 50,
      pool_sats: 0,
    },
  ];
  const tradesChrono: MarketRecentTrade[] = [];

  for (const bet of confirmedBets) {
    if (bet.side === "YES") {
      yesMsat += bet.amountMsat;
    } else {
      noMsat += bet.amountMsat;
    }
    const totalMsat = yesMsat + noMsat;
    const yesPct = totalMsat > 0 ? Math.round((yesMsat / totalMsat) * 1000) / 10 : 50;
    const noPct = Math.round((100 - yesPct) * 10) / 10;
    const poolSats = Math.floor(totalMsat / 1000);
    const ts = (bet.paidAt ?? bet.createdAt).toISOString();

    probabilityHistory.push({
      t: ts,
      yes_pct: yesPct,
      no_pct: noPct,
      pool_sats: poolSats,
    });

    tradesChrono.push({
      id: bet.id,
      side: bet.side,
      amount_sats: Math.floor(bet.amountMsat / 1000),
      trader_label: formatTraderLabel(bet.userPubkey),
      timestamp: ts,
      yes_pct_after: yesPct,
      pool_total_sats_after: poolSats,
    });
  }

  const liveTotalMsat = market.poolYesMsat + market.poolNoMsat;
  const liveYesPct =
    liveTotalMsat > 0
      ? Math.round((market.poolYesMsat / liveTotalMsat) * 1000) / 10
      : 50;
  const liveNoPct = Math.round((100 - liveYesPct) * 10) / 10;
  const livePoolSats = Math.floor(liveTotalMsat / 1000);

  probabilityHistory.push({
    t: new Date().toISOString(),
    yes_pct: liveYesPct,
    no_pct: liveNoPct,
    pool_sats: livePoolSats,
  });

  return {
    recent_trades: tradesChrono.reverse().slice(0, 50),
    probability_history: probabilityHistory,
  };
}

const SignedNostrEventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/i),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/i),
  created_at: z.number().int().positive(),
  kind: z.number().int().nonnegative(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[0-9a-f]{128}$/i),
});

export type PublishMarketResult =
  | {
      ok: true;
      market: schema.Market;
      nostr: {
        note_id: string;
        spec_event_id: string;
        platform_pubkey: string;
        nevent: string;
        naddr: string;
        relays_ok: string[];
        spec_event: VerifiedEvent;
        note_event: VerifiedEvent;
      };
    }
  | {
      ok: false;
      status: 404 | 403 | 409 | 422;
      code: string;
      message: string;
      errors?: string[];
    };

export async function publishMarketDraft(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    draftId: string;
    creatorPubkey: string;
    creatorSignatureEvent?: unknown;
    now?: Date;
    appUrl?: string;
    platformSecretKey?: Uint8Array;
    broadcastFn?: (event: VerifiedEvent, relays: string[]) => Promise<string[]>;
  },
): Promise<PublishMarketResult> {
  const rows = await db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, opts.draftId))
    .limit(1);

  const draft = rows[0];
  if (!draft) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Draft not found" };
  }
  if (draft.creatorPubkey !== opts.creatorPubkey.toLowerCase()) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Only the creator can publish this market" };
  }
  if (draft.status !== "DRAFT") {
    return { ok: false, status: 409, code: "ALREADY_PUBLISHED", message: "Market is already published" };
  }

  const validated = validateFullMarketSpec(draft.spec, { now: opts.now });
  if (!validated.ok) {
    return {
      ok: false,
      status: 422,
      code: "VALIDATION_FAILED",
      message: validated.errors[0] ?? "Market spec validation failed",
      errors: validated.errors,
    };
  }

  let verifiedCreatorSig: VerifiedEvent | null = null;
  if (opts.creatorSignatureEvent !== undefined && opts.creatorSignatureEvent !== null) {
    const parsedSig = SignedNostrEventSchema.safeParse(opts.creatorSignatureEvent);
    if (!parsedSig.success) {
      return {
        ok: false,
        status: 422,
        code: "VALIDATION_FAILED",
        message: "Invalid creator Nostr signature event format",
      };
    }
    const ev = {
      ...parsedSig.data,
      id: parsedSig.data.id.toLowerCase(),
      pubkey: parsedSig.data.pubkey.toLowerCase(),
      sig: parsedSig.data.sig.toLowerCase(),
    };
    if (ev.pubkey !== opts.creatorPubkey.toLowerCase() || !verifyEvent(ev)) {
      return {
        ok: false,
        status: 422,
        code: "VALIDATION_FAILED",
        message: "Creator Nostr signature verification failed",
      };
    }
    const tagHash = ev.tags.find((t) => t[0] === "spec_sha256")?.[1];
    if (tagHash && tagHash !== validated.specSha256) {
      return {
        ok: false,
        status: 422,
        code: "VALIDATION_FAILED",
        message: "Creator signature spec_sha256 does not match draft spec",
      };
    }
    verifiedCreatorSig = ev as VerifiedEvent;
  }

  const platformKeys = opts.platformSecretKey
    ? {
        secretKey: opts.platformSecretKey,
        pubkey: getPublicKey(opts.platformSecretKey).toLowerCase(),
      }
    : getPlatformKeypair();

  const createdAtSec = opts.now ? Math.floor(opts.now.getTime() / 1000) : Math.floor(Date.now() / 1000);
  const specEvent = buildMarketSpecEvent({
    slug: draft.slug,
    spec: validated.spec,
    specSha256: validated.specSha256,
    creatorPubkey: draft.creatorPubkey,
    createdAtSec,
    secretKey: platformKeys.secretKey,
  });
  const noteEvent = buildMarketAnnouncementEvent({
    slug: draft.slug,
    spec: validated.spec,
    platformPubkey: platformKeys.pubkey,
    appUrl: opts.appUrl,
    createdAtSec,
    secretKey: platformKeys.secretKey,
  });

  const relays = getConfiguredRelays();
  const broadcast =
    opts.broadcastFn ??
    (draft.isDemo
      ? async () => [] as string[]
      : (ev: VerifiedEvent, r: string[]) => broadcastEventToRelays(ev, r));
  const [specRelaysOk, noteRelaysOk] = await Promise.all([
    broadcast(specEvent, relays),
    broadcast(noteEvent, relays),
  ]);

  const txResult = await db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(schema.markets)
      .set({
        status: "OPEN",
        spec: validated.spec,
        specSha256: validated.specSha256,
        nostrNoteId: noteEvent.id,
      })
      .where(and(eq(schema.markets.id, draft.id), eq(schema.markets.status, "DRAFT")))
      .returning();

    if (updatedRows.length === 0) {
      return null;
    }

    await tx
      .insert(schema.nostrEvents)
      .values({
        id: specEvent.id,
        marketId: draft.id,
        kind: specEvent.kind,
        event: specEvent,
        relaysOk: specRelaysOk,
      })
      .onConflictDoNothing();

    await tx
      .insert(schema.nostrEvents)
      .values({
        id: noteEvent.id,
        marketId: draft.id,
        kind: noteEvent.kind,
        event: noteEvent,
        relaysOk: noteRelaysOk,
      })
      .onConflictDoNothing();

    if (verifiedCreatorSig) {
      await tx
        .insert(schema.nostrEvents)
        .values({
          id: verifiedCreatorSig.id,
          marketId: draft.id,
          kind: verifiedCreatorSig.kind,
          event: verifiedCreatorSig,
          relaysOk: [],
        })
        .onConflictDoNothing();
    }

    return updatedRows[0];
  });

  if (!txResult) {
    return { ok: false, status: 409, code: "ALREADY_PUBLISHED", message: "Market is already published" };
  }

  const relaysOk = Array.from(new Set([...specRelaysOk, ...noteRelaysOk]));
  const pointers = encodeMarketPointers({
    noteId: noteEvent.id,
    slug: draft.slug,
    platformPubkey: platformKeys.pubkey,
    relays: relaysOk.length > 0 ? relaysOk : relays,
  });

  return {
    ok: true,
    market: txResult,
    nostr: {
      note_id: noteEvent.id,
      spec_event_id: specEvent.id,
      platform_pubkey: platformKeys.pubkey,
      nevent: pointers.nevent,
      naddr: pointers.naddr,
      relays_ok: relaysOk,
      spec_event: specEvent,
      note_event: noteEvent,
    },
  };
}
