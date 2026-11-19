/**
 * Core domain constants shared by the AI layer, API, DB and UI.
 * See docs/03-market-lifecycle.md and docs/05-oracle-design.md.
 */

export const CATEGORIES = [
  "Sports",
  "Politics",
  "Crypto",
  "Esports",
  "Finance",
  "Technology",
  "Economy",
  "Culture",
  "Weather",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const RESOLUTION_TRACKS = ["auto_api", "nostr_oracle"] as const;
export type ResolutionTrack = (typeof RESOLUTION_TRACKS)[number];

export const MARKET_STATUSES = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "RESOLVING",
  "PENDING_RESOLUTION",
  "PROPOSED",
  "DISPUTED",
  "RESOLVED",
  "VOID",
  "SETTLING",
  "SETTLED",
] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];

export const OUTCOMES = ["YES", "NO", "INVALID"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const SIDES = ["YES", "NO"] as const;
export type Side = (typeof SIDES)[number];

export const BET_STATUSES = ["PENDING", "CONFIRMED", "EXPIRED", "LATE", "REFUNDED"] as const;
export type BetStatus = (typeof BET_STATUSES)[number];

export const PAYOUT_STATUSES = ["QUEUED", "SENDING", "SENT", "FAILED", "CLAIMABLE"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_KINDS = ["WIN", "REFUND", "BOND_RETURN"] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

/** Allowlisted Track A providers. The AI may only reference these ids — never raw URLs. */
export const ORACLE_PROVIDERS = [
  "open-meteo",
  "binance",
  "mempool",
  "coingecko",
  "frankfurter",
  "github",
  "thesportsdb",
  "opendota",
] as const;
export type OracleProvider = (typeof ORACLE_PROVIDERS)[number];

export const SIGNER_POLICIES = ["platform_signer", "multisig_2_of_3", "optimistic_bond"] as const;
export type SignerPolicy = (typeof SIGNER_POLICIES)[number];

export const CONDITION_OPERATORS = [">", ">=", "<", "<=", "==", "!="] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Statuses during which bets are accepted. */
export const BETTABLE_STATUSES: readonly MarketStatus[] = ["OPEN"];

/** Runtime-neutral fetch signature compatible with both Bun and Node type definitions. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
