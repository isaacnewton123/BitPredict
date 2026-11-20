import type { MarketSpec } from "./market-spec";

export interface TimeRuleViolation {
  field: "betting_cutoff_utc" | "deadline_utc" | "resolve_after_utc";
  message: string;
}

export interface TimeRuleOptions {
  now?: Date;
  /** Minimum time between now and betting cutoff (default 60s). */
  minOpenMs?: number;
  /** Maximum market horizon (default 5 years to support multi-year events such as elections). */
  maxHorizonMs?: number;
}

/**
 * Enforces the lifecycle invariant (docs/03-market-lifecycle.md §3):
 *   now < betting_cutoff <= deadline_utc <= resolve_after_utc
 */
export function checkTimeRules(
  spec: Pick<MarketSpec, "betting_cutoff_utc" | "deadline_utc" | "resolve_after_utc">,
  opts: TimeRuleOptions = {},
): TimeRuleViolation[] {
  const now = (opts.now ?? new Date()).getTime();
  const minOpenMs = opts.minOpenMs ?? 60_000;
  const maxHorizonMs = opts.maxHorizonMs ?? 5 * 365 * 24 * 3600 * 1000;

  const cutoff = Date.parse(spec.betting_cutoff_utc);
  const deadline = Date.parse(spec.deadline_utc);
  const resolveAfter = Date.parse(spec.resolve_after_utc);
  const v: TimeRuleViolation[] = [];

  if (Number.isNaN(cutoff)) v.push({ field: "betting_cutoff_utc", message: "Invalid date" });
  if (Number.isNaN(deadline)) v.push({ field: "deadline_utc", message: "Invalid date" });
  if (Number.isNaN(resolveAfter)) v.push({ field: "resolve_after_utc", message: "Invalid date" });
  if (v.length) return v;

  if (cutoff - now < minOpenMs) {
    v.push({ field: "betting_cutoff_utc", message: "Betting cutoff must be in the future (with time left to bet)" });
  }
  if (cutoff > deadline) {
    v.push({ field: "betting_cutoff_utc", message: "Betting cutoff must be on or before the deadline" });
  }
  if (deadline > resolveAfter) {
    v.push({ field: "resolve_after_utc", message: "Resolve time must be on or after the deadline" });
  }
  if (resolveAfter - now > maxHorizonMs) {
    v.push({ field: "resolve_after_utc", message: "Market horizon is too far in the future" });
  }
  return v;
}
