/**
 * Database schema (SQLite / libSQL flavour of docs/08-data-model.md).
 * - Amounts are integer millisatoshis.
 * - Timestamps are stored as integer unix milliseconds (mode: "timestamp_ms").
 * - JSON columns are TEXT with mode: "json".
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  BET_STATUSES,
  CATEGORIES,
  MARKET_STATUSES,
  OUTCOMES,
  PAYOUT_KINDS,
  PAYOUT_STATUSES,
  RESOLUTION_TRACKS,
  SIDES,
} from "../domain/constants";
import type { MarketSpec } from "../domain/market-spec";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());

export const users = sqliteTable("users", {
  pubkey: text("pubkey").primaryKey(), // hex
  lightningAddress: text("lightning_address"),
  nwcUriEnc: text("nwc_uri_enc"), // encrypted; only if user opts in to server-side payouts
  isGuest: integer("is_guest", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const markets = sqliteTable(
  "markets",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    creatorPubkey: text("creator_pubkey").notNull().references(() => users.pubkey),
    status: text("status", { enum: MARKET_STATUSES }).notNull().default("DRAFT"),
    category: text("category", { enum: CATEGORIES }).notNull(),
    track: text("track", { enum: RESOLUTION_TRACKS }).notNull(),
    title: text("title").notNull(),
    spec: text("spec", { mode: "json" }).$type<MarketSpec>().notNull(),
    specSha256: text("spec_sha256").notNull(),
    bettingCutoff: integer("betting_cutoff", { mode: "timestamp_ms" }).notNull(),
    deadlineUtc: integer("deadline_utc", { mode: "timestamp_ms" }).notNull(),
    resolveAfter: integer("resolve_after", { mode: "timestamp_ms" }).notNull(),
    poolYesMsat: integer("pool_yes_msat").notNull().default(0),
    poolNoMsat: integer("pool_no_msat").notNull().default(0),
    feeBps: integer("fee_bps").notNull().default(200),
    outcome: text("outcome", { enum: OUTCOMES }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    nostrNoteId: text("nostr_note_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("markets_status_resolve_idx").on(t.status, t.resolveAfter),
    index("markets_category_status_idx").on(t.category, t.status),
    check("markets_time_order", sql`${t.bettingCutoff} <= ${t.deadlineUtc} AND ${t.deadlineUtc} <= ${t.resolveAfter}`),
  ],
);

export const bets = sqliteTable(
  "bets",
  {
    id: id(),
    marketId: text("market_id").notNull().references(() => markets.id),
    userPubkey: text("user_pubkey").notNull().references(() => users.pubkey),
    side: text("side", { enum: SIDES }).notNull(),
    amountMsat: integer("amount_msat").notNull(),
    paymentHash: text("payment_hash").notNull().unique(),
    bolt11: text("bolt11").notNull(),
    status: text("status", { enum: BET_STATUSES }).notNull().default("PENDING"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("bets_market_status_idx").on(t.marketId, t.status), check("bets_amount_pos", sql`${t.amountMsat} > 0`)],
);

export const oracleProofs = sqliteTable("oracle_proofs", {
  id: id(),
  marketId: text("market_id").notNull().references(() => markets.id),
  provider: text("provider").notNull(),
  url: text("url").notNull(),
  httpStatus: integer("http_status"),
  body: text("body", { mode: "json" }),
  bodySha256: text("body_sha256"),
  value: text("value"), // decimal as string to avoid float drift
  fetchedAt: createdAt(),
});

export const signers = sqliteTable("signers", {
  pubkey: text("pubkey").primaryKey(),
  policy: text("policy").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  resolvedCount: integer("resolved_count").notNull().default(0),
  disputesLost: integer("disputes_lost").notNull().default(0),
});

export const proposals = sqliteTable("proposals", {
  id: id(),
  marketId: text("market_id").notNull().references(() => markets.id),
  signerPubkey: text("signer_pubkey").notNull(),
  outcome: text("outcome", { enum: OUTCOMES }).notNull(),
  proofUrls: text("proof_urls", { mode: "json" }).$type<string[]>().notNull(),
  nostrEvent: text("nostr_event", { mode: "json" }).notNull(),
  bondMsat: integer("bond_msat").notNull().default(0),
  challengeEndsAt: integer("challenge_ends_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { enum: ["ACTIVE", "ACCEPTED", "DISPUTED", "REJECTED"] }).notNull().default("ACTIVE"),
  createdAt: createdAt(),
});

export const disputes = sqliteTable("disputes", {
  id: id(),
  proposalId: text("proposal_id").notNull().references(() => proposals.id),
  disputerPubkey: text("disputer_pubkey").notNull(),
  bondPaymentHash: text("bond_payment_hash").unique(),
  proofUrls: text("proof_urls", { mode: "json" }).$type<string[]>().notNull(),
  nostrEvent: text("nostr_event", { mode: "json" }).notNull(),
  status: text("status", { enum: ["OPEN", "UPHELD", "REJECTED"] }).notNull().default("OPEN"),
  createdAt: createdAt(),
});

export const payouts = sqliteTable(
  "payouts",
  {
    id: id(),
    marketId: text("market_id").notNull().references(() => markets.id),
    userPubkey: text("user_pubkey").notNull().references(() => users.pubkey),
    kind: text("kind", { enum: PAYOUT_KINDS }).notNull(),
    amountMsat: integer("amount_msat").notNull(),
    status: text("status", { enum: PAYOUT_STATUSES }).notNull().default("QUEUED"),
    attempts: integer("attempts").notNull().default(0),
    bolt11: text("bolt11"),
    paymentHash: text("payment_hash"),
    preimage: text("preimage"),
    lastError: text("last_error"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("payouts_market_user_kind_uq").on(t.marketId, t.userPubkey, t.kind)],
);

export const ledgerEntries = sqliteTable("ledger_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account: text("account").notNull(), // escrow | market:<id> | fees | user:<pubkey>
  amountMsat: integer("amount_msat").notNull(), // +credit / -debit
  refType: text("ref_type", { enum: ["bet", "payout", "refund", "fee", "dust", "bond"] }).notNull(),
  refId: text("ref_id"),
  createdAt: createdAt(),
});

export const nostrEvents = sqliteTable("nostr_events", {
  id: text("id").primaryKey(),
  marketId: text("market_id").references(() => markets.id),
  kind: integer("kind").notNull(),
  event: text("event", { mode: "json" }).notNull(),
  relaysOk: text("relays_ok", { mode: "json" }).$type<string[]>(),
  createdAt: createdAt(),
});

export const aiRuns = sqliteTable("ai_runs", {
  id: id(),
  purpose: text("purpose", { enum: ["market_spec", "insight", "evidence"] }).notNull(),
  marketId: text("market_id").references(() => markets.id),
  model: text("model").notNull(),
  promptSha256: text("prompt_sha256").notNull(),
  input: text("input", { mode: "json" }).notNull(),
  output: text("output", { mode: "json" }),
  valid: integer("valid", { mode: "boolean" }),
  latencyMs: integer("latency_ms"),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
export type Bet = typeof bets.$inferSelect;
