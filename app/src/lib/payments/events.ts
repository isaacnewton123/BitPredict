import type { MarketStatus, Outcome } from "@/lib/domain/constants";

export interface MarketPoolUpdate {
  market_id: string;
  pool_yes_msat: number;
  pool_no_msat: number;
  status: MarketStatus;
  outcome: Outcome | null;
  updated_at: string;
}

type PoolListener = (update: MarketPoolUpdate) => void;

declare global {
  // eslint-disable-next-line no-var
  var __bitpredictPoolBus: Map<string, Set<PoolListener>> | undefined;
}

function getBus(): Map<string, Set<PoolListener>> {
  if (!globalThis.__bitpredictPoolBus) {
    globalThis.__bitpredictPoolBus = new Map();
  }
  return globalThis.__bitpredictPoolBus;
}

export function subscribeMarketPool(marketId: string, listener: PoolListener): () => void {
  const bus = getBus();
  let set = bus.get(marketId);
  if (!set) {
    set = new Set();
    bus.set(marketId, set);
  }
  set.add(listener);
  return () => {
    const current = bus.get(marketId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      bus.delete(marketId);
    }
  };
}

export function emitMarketPoolUpdate(update: MarketPoolUpdate): void {
  const listeners = getBus().get(update.market_id);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(update);
    } catch {
      // ignore closed subscriber errors
    }
  }
}
