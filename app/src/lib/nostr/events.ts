import * as nip19 from "nostr-tools/nip19";
import { finalizeEvent, type VerifiedEvent } from "nostr-tools/pure";
import { canonicalizeJson } from "@/lib/domain/canonical-json";
import type { Outcome, ResolutionTrack } from "@/lib/domain/constants";
import type { MarketSpec } from "@/lib/domain/market-spec";
import { getPlatformKeypair, getPlatformOracleKeypair } from "./keys";

export const TEXT_NOTE_KIND = 1;
export const MARKET_SPEC_KIND = 30078;
export const OUTCOME_ATTESTATION_KIND = 30079;
export const DISPUTE_EVENT_KIND = 30080;

export function buildMarketSpecEvent(opts: {
  slug: string;
  spec: MarketSpec;
  specSha256: string;
  creatorPubkey: string;
  createdAtSec?: number;
  secretKey?: Uint8Array;
}): VerifiedEvent {
  const secretKey = opts.secretKey ?? getPlatformKeypair().secretKey;
  const createdAt = opts.createdAtSec ?? Math.floor(Date.now() / 1000);
  const cutoffSec = Math.floor(Date.parse(opts.spec.betting_cutoff_utc) / 1000);
  const deadlineSec = Math.floor(Date.parse(opts.spec.deadline_utc) / 1000);

  return finalizeEvent(
    {
      kind: MARKET_SPEC_KIND,
      created_at: createdAt,
      tags: [
        ["d", `market:${opts.slug}`],
        ["category", opts.spec.category],
        ["track", opts.spec.resolution_track],
        ["cutoff", String(cutoffSec)],
        ["deadline", String(deadlineSec)],
        ["spec_sha256", opts.specSha256],
        ["p", opts.creatorPubkey.toLowerCase()],
      ],
      content: canonicalizeJson(opts.spec),
    },
    secretKey,
  );
}

export function buildMarketAnnouncementEvent(opts: {
  slug: string;
  spec: MarketSpec;
  platformPubkey: string;
  appUrl?: string;
  createdAtSec?: number;
  secretKey?: Uint8Array;
}): VerifiedEvent {
  const secretKey = opts.secretKey ?? getPlatformKeypair().secretKey;
  const createdAt = opts.createdAtSec ?? Math.floor(Date.now() / 1000);
  const baseUrl = (opts.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const marketUrl = `${baseUrl}/m/${opts.slug}`;
  const catTag = opts.spec.category.toLowerCase();

  const content = [
    `🔮 New BitPredict market: ${opts.spec.question}`,
    `YES 50% · Bet in sats ⚡ ${marketUrl}`,
    `#bitpredict #predictionmarket #${catTag}`,
  ].join("\n");

  return finalizeEvent(
    {
      kind: TEXT_NOTE_KIND,
      created_at: createdAt,
      tags: [
        ["t", "bitpredict"],
        ["t", "predictionmarket"],
        ["t", catTag],
        ["a", `${MARKET_SPEC_KIND}:${opts.platformPubkey.toLowerCase()}:market:${opts.slug}`],
        ["r", marketUrl],
      ],
      content,
    },
    secretKey,
  );
}

export function encodeMarketPointers(opts: {
  noteId: string;
  slug: string;
  platformPubkey: string;
  relays: string[];
}): { nevent: string; naddr: string } {
  const relays = opts.relays.slice(0, 3);
  return {
    nevent: nip19.neventEncode({
      id: opts.noteId,
      author: opts.platformPubkey.toLowerCase(),
      relays,
    }),
    naddr: nip19.naddrEncode({
      kind: MARKET_SPEC_KIND,
      pubkey: opts.platformPubkey.toLowerCase(),
      identifier: `market:${opts.slug}`,
      relays,
    }),
  };
}

export function buildOutcomeAttestationEvent(opts: {
  slug: string;
  marketNoteId?: string | null;
  platformPubkey: string;
  outcome: Outcome;
  specSha256: string;
  proofUrl: string;
  proofSha256: string;
  track: ResolutionTrack;
  summary: string;
  createdAtSec?: number;
  secretKey?: Uint8Array;
}): VerifiedEvent {
  const secretKey = opts.secretKey ?? getPlatformOracleKeypair().secretKey;
  const createdAt = opts.createdAtSec ?? Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["d", `outcome:${opts.slug}`],
    ["a", `${MARKET_SPEC_KIND}:${opts.platformPubkey.toLowerCase()}:market:${opts.slug}`],
  ];
  if (opts.marketNoteId) {
    tags.push(["e", opts.marketNoteId, "", "root"]);
  }
  tags.push(
    ["outcome", opts.outcome],
    ["spec_sha256", opts.specSha256],
    ["proof_sha256", opts.proofSha256],
    ["proof", opts.proofUrl],
    ["track", opts.track],
  );

  return finalizeEvent(
    {
      kind: OUTCOME_ATTESTATION_KIND,
      created_at: createdAt,
      tags,
      content: opts.summary,
    },
    secretKey,
  );
}

export function buildSettlementNoteEvent(opts: {
  slug: string;
  marketNoteId?: string | null;
  platformPubkey: string;
  outcome: Outcome | null;
  totalPoolSats: number;
  paidSats: number;
  feeSats: number;
  payoutCount: number;
  isRefund: boolean;
  appUrl?: string;
  createdAtSec?: number;
  secretKey?: Uint8Array;
}): VerifiedEvent {
  const secretKey = opts.secretKey ?? getPlatformKeypair().secretKey;
  const createdAt = opts.createdAtSec ?? Math.floor(Date.now() / 1000);
  const baseUrl = (opts.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const proofUrl = `${baseUrl}/m/${opts.slug}`;

  const tags: string[][] = [
    ["t", "bitpredict"],
    ["a", `${MARKET_SPEC_KIND}:${opts.platformPubkey.toLowerCase()}:market:${opts.slug}`],
    ["r", proofUrl],
  ];
  if (opts.marketNoteId) {
    tags.push(["e", opts.marketNoteId, "", "root"]);
  }

  const summary = opts.isRefund
    ? `⚡ Market Settled (REFUND / ${opts.outcome ?? "VOID"}): ${opts.totalPoolSats.toLocaleString("en-US")} sats refunded across ${opts.payoutCount} bettor(s). Proof: ${proofUrl}`
    : `⚡ Market Settled (${opts.outcome ?? "RESOLVED"}): ${opts.paidSats.toLocaleString("en-US")} sats paid to ${opts.payoutCount} winner(s) from ${opts.totalPoolSats.toLocaleString("en-US")} sats pool (fee ${opts.feeSats.toLocaleString("en-US")} sats). Proof: ${proofUrl}`;

  return finalizeEvent(
    {
      kind: TEXT_NOTE_KIND,
      created_at: createdAt,
      tags,
      content: summary,
    },
    secretKey,
  );
}

export function buildDisputeEvent(opts: {
  slug: string;
  proposalEventId: string;
  platformPubkey: string;
  proofUrls: string[];
  reason: string;
  bondPaymentHash?: string;
  createdAtSec?: number;
  secretKey: Uint8Array;
}): VerifiedEvent {
  const createdAt = opts.createdAtSec ?? Math.floor(Date.now() / 1000);
  const tags: string[][] = [
    ["d", `dispute:${opts.slug}:${opts.proposalEventId.slice(0, 8)}`],
    ["a", `${MARKET_SPEC_KIND}:${opts.platformPubkey.toLowerCase()}:market:${opts.slug}`],
    ["e", opts.proposalEventId, "", "reply"],
  ];
  if (opts.bondPaymentHash) {
    tags.push(["bond_payment_hash", opts.bondPaymentHash]);
  }
  for (const url of opts.proofUrls) {
    tags.push(["proof", url]);
  }

  return finalizeEvent(
    {
      kind: DISPUTE_EVENT_KIND,
      created_at: createdAt,
      tags,
      content: opts.reason,
    },
    opts.secretKey,
  );
}
