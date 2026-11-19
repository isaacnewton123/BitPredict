import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import {
  getMarketActivityFromDb,
  getMarketByIdOrSlugFromDb,
  getMarketEventsFromDb,
  queryMarkets,
  type QueryMarketsOptions,
} from "./publish-repo";

export async function listMarkets(opts: QueryMarketsOptions = {}) {
  return queryMarkets(db, opts);
}

export async function getMarketBySlug(slug: string) {
  const rows = await db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.slug, slug))
    .limit(1);
  return rows[0];
}

export async function getMarketByIdOrSlug(idOrSlug: string) {
  return getMarketByIdOrSlugFromDb(db, idOrSlug);
}

export async function getMarketEvents(marketId: string) {
  return getMarketEventsFromDb(db, marketId);
}

export async function getMarketActivity(market: schema.Market) {
  return getMarketActivityFromDb(db, market);
}
