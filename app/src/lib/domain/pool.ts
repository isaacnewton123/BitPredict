/**
 * Parimutuel helpers (docs/06-lightning-payments.md §3).
 */

import type { Outcome, PayoutKind, Side } from "./constants";

/** Implied P(YES) in [0,1]. Returns 0.5 for an empty market. */
export function impliedYesProbability(poolYesMsat: number | bigint, poolNoMsat: number | bigint): number {
  const yes = Number(poolYesMsat);
  const no = Number(poolNoMsat);
  const total = yes + no;
  if (total <= 0) return 0.5;
  return yes / total;
}

export function formatSats(msat: number | bigint): string {
  const sats = Math.floor(Number(msat) / 1000);
  return new Intl.NumberFormat("en-US").format(sats);
}

/**
 * Estimates payout in msat using fee-on-losing-pool parimutuel math:
 *   payout = stake + floor(stake / (winPool + stake) * losePool * (1 - feeBps / 10000))
 */
export function estimatePotentialPayoutMsat(opts: {
  side: Side;
  stakeMsat: number;
  poolYesMsat: number;
  poolNoMsat: number;
  feeBps?: number;
}): { payoutMsat: number; profitMsat: number; multiplier: number } {
  const stake = Math.max(0, Math.floor(opts.stakeMsat));
  if (stake === 0) {
    return { payoutMsat: 0, profitMsat: 0, multiplier: 1 };
  }

  const feeBps = opts.feeBps ?? 200;
  const currentWinPool = Math.max(0, Math.floor(opts.side === "YES" ? opts.poolYesMsat : opts.poolNoMsat));
  const currentLosePool = Math.max(0, Math.floor(opts.side === "YES" ? opts.poolNoMsat : opts.poolYesMsat));
  const winPoolAfter = currentWinPool + stake;

  const profitMsat = Number(
    (BigInt(stake) * BigInt(currentLosePool) * BigInt(10_000 - feeBps)) /
      (BigInt(winPoolAfter) * 10_000n),
  );
  const payoutMsat = stake + profitMsat;

  return {
    payoutMsat,
    profitMsat,
    multiplier: payoutMsat / stake,
  };
}

export interface SettlementPayoutItem {
  userPubkey: string;
  kind: Extract<PayoutKind, "WIN" | "REFUND">;
  amountMsat: number;
}

export interface MarketSettlementPlan {
  isRefund: boolean;
  poolYesMsat: number;
  poolNoMsat: number;
  totalMsat: number;
  feeMsat: number;
  dustMsat: number;
  payouts: SettlementPayoutItem[];
}

/**
 * Computes exact parimutuel payouts (or 100% refunds on VOID / one-sided pools) in millisatoshis.
 * Invariant: sum(payouts) + feeMsat + dustMsat === totalMsat.
 */
export function computeMarketSettlement(opts: {
  outcome: Outcome | null;
  feeBps: number;
  confirmedBets: Array<{ userPubkey: string; side: Side; amountMsat: number }>;
}): MarketSettlementPlan {
  let poolYesMsat = 0;
  let poolNoMsat = 0;
  for (const bet of opts.confirmedBets) {
    if (bet.amountMsat <= 0) continue;
    if (bet.side === "YES") poolYesMsat += bet.amountMsat;
    else poolNoMsat += bet.amountMsat;
  }
  const totalMsat = poolYesMsat + poolNoMsat;

  const isVoidOrOneSided =
    opts.outcome === null ||
    opts.outcome === "INVALID" ||
    poolYesMsat === 0 ||
    poolNoMsat === 0;

  if (isVoidOrOneSided) {
    const byUser = new Map<string, number>();
    for (const bet of opts.confirmedBets) {
      if (bet.amountMsat <= 0) continue;
      const key = bet.userPubkey.toLowerCase();
      byUser.set(key, (byUser.get(key) ?? 0) + bet.amountMsat);
    }
    const payouts: SettlementPayoutItem[] = Array.from(byUser.entries()).map(
      ([userPubkey, amountMsat]) => ({
        userPubkey,
        kind: "REFUND",
        amountMsat,
      }),
    );
    return {
      isRefund: true,
      poolYesMsat,
      poolNoMsat,
      totalMsat,
      feeMsat: 0,
      dustMsat: 0,
      payouts,
    };
  }

  const winSide: Side = opts.outcome === "YES" ? "YES" : "NO";
  const winPool = winSide === "YES" ? poolYesMsat : poolNoMsat;
  const losePool = winSide === "YES" ? poolNoMsat : poolYesMsat;

  const feeMsat = Number((BigInt(losePool) * BigInt(opts.feeBps)) / 10_000n);
  const distributableLose = losePool - feeMsat;

  const winByUser = new Map<string, number>();
  for (const bet of opts.confirmedBets) {
    if (bet.amountMsat <= 0 || bet.side !== winSide) continue;
    const key = bet.userPubkey.toLowerCase();
    winByUser.set(key, (winByUser.get(key) ?? 0) + bet.amountMsat);
  }

  let sumPayouts = 0;
  const payouts: SettlementPayoutItem[] = Array.from(winByUser.entries()).map(
    ([userPubkey, stake]) => {
      const shareOfLose = Number(
        (BigInt(stake) * BigInt(distributableLose)) / BigInt(winPool),
      );
      const amountMsat = stake + shareOfLose;
      sumPayouts += amountMsat;
      return {
        userPubkey,
        kind: "WIN",
        amountMsat,
      };
    },
  );

  const dustMsat = totalMsat - feeMsat - sumPayouts;
  return {
    isRefund: false,
    poolYesMsat,
    poolNoMsat,
    totalMsat,
    feeMsat,
    dustMsat,
    payouts,
  };
}
