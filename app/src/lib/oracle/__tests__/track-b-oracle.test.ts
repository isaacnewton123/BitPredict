import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileMarketPrompt } from "@/lib/ai/compiler";
import { getOrGenerateEvidenceSummary } from "@/lib/ai/evidence";
import * as schema from "@/lib/db/schema";
import { createMarketDraft } from "@/lib/markets/draft-repo";
import { publishMarketDraft } from "@/lib/markets/publish-repo";
import { DISPUTE_EVENT_KIND, OUTCOME_ATTESTATION_KIND } from "@/lib/nostr/events";
import {
  ruleOnDispute,
  submitTrackBDispute,
  submitTrackBProposal,
} from "@/lib/oracle/track-b-repo";
import { runOracleTick } from "@/lib/oracle/worker-repo";
import { placeBetOrder, settleBetByPaymentHash } from "@/lib/payments/bet-repo";
import { listUserPayoutsFromDb } from "@/lib/payments/settlement-repo";

const MIGRATION_PATH = path.resolve(process.cwd(), "drizzle/0000_mute_may_parker.sql");
const FIXED_NOW = new Date("2026-11-19T12:00:00Z");

describe("Track B Nostr Optimistic Oracle", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  const creatorPubkey = "1".repeat(64);
  const aliceSk = generateSecretKey();
  const alicePubkey = getPublicKey(aliceSk).toLowerCase();
  const aliceCloneSk = generateSecretKey();
  const aliceClonePubkey = getPublicKey(aliceCloneSk).toLowerCase();
  const bobSk = generateSecretKey();
  const bobPubkey = getPublicKey(bobSk).toLowerCase();
  const signerSk = generateSecretKey();
  const signerPubkey = getPublicKey(signerSk).toLowerCase();
  const disputerSk = generateSecretKey();
  const disputerPubkey = getPublicKey(disputerSk).toLowerCase();
  const adminPubkey = "9".repeat(64);

  beforeAll(async () => {
    client = createClient({ url: ":memory:" });
    await client.execute("PRAGMA foreign_keys = ON;");
    const stmts = fs
      .readFileSync(MIGRATION_PATH, "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of stmts) await client.execute(s);
    db = drizzle(client, { schema });

    await db.insert(schema.users).values([
      { pubkey: creatorPubkey },
      { pubkey: alicePubkey, lightningAddress: "alice@getalby.com" },
      { pubkey: aliceClonePubkey, lightningAddress: "alice@getalby.com" },
      { pubkey: bobPubkey, lightningAddress: "bob@getalby.com" },
      { pubkey: signerPubkey, lightningAddress: "signer@getalby.com" },
      { pubkey: disputerPubkey, lightningAddress: "disputer@getalby.com" },
    ]);
  });

  afterAll(() => {
    client.close();
  });

  async function publishTrackBMarket(prompt: string) {
    const compiled = await compileMarketPrompt({ prompt, now: FIXED_NOW, apiKey: "" });
    if (!compiled.ok) throw new Error("Compile failed");
    const draft = await createMarketDraft(db, {
      creatorPubkey,
      prompt,
      compiled,
    });
    const pub = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      now: FIXED_NOW,
      broadcastFn: async () => [],
    });
    if (!pub.ok) throw new Error("Publish failed");
    return pub.market;
  }

  async function confirmBet(marketId: string, userPubkey: string, side: "YES" | "NO", amountSats: number) {
    const order = await placeBetOrder(db, {
      marketIdOrSlug: marketId,
      userPubkey,
      side,
      amountSats,
      now: FIXED_NOW,
    });
    if (!order.ok) throw new Error(`Bet order failed: ${order.message}`);
    const settled = await settleBetByPaymentHash(db, {
      paymentHash: order.payment_hash,
      now: FIXED_NOW,
      verifyPaymentFn: async () => ({ paid: true }),
    });
    if (!settled.ok) throw new Error(`Bet settle failed: ${settled.message}`);
  }

  function signProposal(
    sk: Uint8Array,
    market: schema.Market,
    outcome: "YES" | "NO" | "INVALID",
    proofUrl = "https://apnews.com/official-result",
  ) {
    return finalizeEvent(
      {
        kind: OUTCOME_ATTESTATION_KIND,
        created_at: Math.floor(FIXED_NOW.getTime() / 1000),
        tags: [
          ["d", `outcome:${market.slug}`],
          ["outcome", outcome],
          ["spec_sha256", market.specSha256],
          ["proof", proofUrl],
          ["track", "nostr_oracle"],
        ],
        content: `Verified outcome ${outcome} via ${proofUrl}`,
      },
      sk,
    );
  }

  it("blocks conflict-of-interest both ways (bettors cannot propose; proposers cannot bet)", async () => {
    const sportsMkt = await publishTrackBMarket(
      "Will Senegal win their next AFCON qualifier match on 2026-12-10?",
    );
    await confirmBet(sportsMkt.id, alicePubkey, "YES", 1_000);

    // Move to PENDING_RESOLUTION
    const resolveNow = new Date(sportsMkt.resolveAfter.getTime() + 1_000);
    await runOracleTick(db, { now: resolveNow, broadcastFn: async () => [] });

    // 1) Direct bettor Alice tries to propose -> 403 SIGNER_CONFLICT_OF_INTEREST
    const aliceProp = await submitTrackBProposal(db, {
      marketIdOrSlug: sportsMkt.id,
      nostrEvent: signProposal(aliceSk, sportsMkt, "YES"),
      now: resolveNow,
      allowedSigners: [alicePubkey, aliceClonePubkey, signerPubkey],
      broadcastFn: async () => [],
    });
    expect(aliceProp.ok).toBe(false);
    if (!aliceProp.ok) {
      expect(aliceProp.status).toBe(403);
      expect(aliceProp.code).toBe("SIGNER_CONFLICT_OF_INTEREST");
    }

    // 2) Secondary pubkey sharing Alice's Lightning Address tries to propose -> 403
    const cloneProp = await submitTrackBProposal(db, {
      marketIdOrSlug: sportsMkt.id,
      nostrEvent: signProposal(aliceCloneSk, sportsMkt, "YES"),
      now: resolveNow,
      allowedSigners: [alicePubkey, aliceClonePubkey, signerPubkey],
      broadcastFn: async () => [],
    });
    expect(cloneProp.ok).toBe(false);
    if (!cloneProp.ok) {
      expect(cloneProp.status).toBe(403);
      expect(cloneProp.code).toBe("SIGNER_CONFLICT_OF_INTEREST");
    }

    // 3) Signer who already proposed on an open demo market cannot place a bet on it
    const openMkt = await publishTrackBMarket(
      "Will the headline music festival concert sell out before 2026-12-15?",
    );
    const propRes = await submitTrackBProposal(db, {
      marketIdOrSlug: openMkt.id,
      nostrEvent: signProposal(signerSk, openMkt, "YES"),
      now: FIXED_NOW,
      forceReadyInDemo: true,
      allowedSigners: [signerPubkey],
      broadcastFn: async () => [],
    });
    expect(propRes.ok).toBe(true);

    // Also test direct proposal-conflict check when market is OPEN
    await db
      .update(schema.markets)
      .set({ status: "OPEN" })
      .where(eq(schema.markets.id, openMkt.id));

    const conflictBet = await placeBetOrder(db, {
      marketIdOrSlug: openMkt.id,
      userPubkey: signerPubkey,
      side: "YES",
      amountSats: 100,
      now: FIXED_NOW,
    });
    expect(conflictBet.ok).toBe(false);
    if (!conflictBet.ok) {
      expect(conflictBet.status).toBe(403);
      expect(conflictBet.code).toBe("SIGNER_CONFLICT_OF_INTEREST");
    }
  });

  it("resolves undisputed Track B market after challenge window and automatically pays winners", async () => {
    const mkt = await publishTrackBMarket(
      "Will Real Madrid win the Champions League final on 2027-05-30?",
    );
    await confirmBet(mkt.id, alicePubkey, "YES", 2_000);
    await confirmBet(mkt.id, bobPubkey, "NO", 1_000);

    const resolveTime = new Date(mkt.resolveAfter.getTime() + 1_000);
    const tick1 = await runOracleTick(db, { now: resolveTime, broadcastFn: async () => [] });
    expect(tick1.pending_track_b_count).toBeGreaterThanOrEqual(1);

    const evidence = await getOrGenerateEvidenceSummary(db, mkt.id, { apiKey: "" });
    expect(evidence?.summary).toContain(mkt.spec.question);

    const prop = await submitTrackBProposal(db, {
      marketIdOrSlug: mkt.id,
      nostrEvent: signProposal(signerSk, mkt, "YES"),
      now: resolveTime,
      allowedSigners: [signerPubkey],
      challengeWindowSec: 120,
      broadcastFn: async () => [],
    });
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    expect(prop.market.status).toBe("PROPOSED");

    // Tick BEFORE challenge window expires -> stays PROPOSED
    await runOracleTick(db, {
      now: new Date(resolveTime.getTime() + 60_000),
      broadcastFn: async () => [],
    });
    const midMkt = await db.select().from(schema.markets).where(eq(schema.markets.id, mkt.id));
    expect(midMkt[0].status).toBe("PROPOSED");

    // Tick AFTER challenge window expires -> RESOLVED -> SETTLED + Alice paid 2,980 sats
    await runOracleTick(db, {
      now: new Date(resolveTime.getTime() + 125_000),
      broadcastFn: async () => [],
    });

    const endMkt = await db.select().from(schema.markets).where(eq(schema.markets.id, mkt.id));
    expect(endMkt[0].status).toBe("SETTLED");
    expect(endMkt[0].outcome).toBe("YES");

    const alicePayouts = await listUserPayoutsFromDb(db, alicePubkey, mkt.id);
    expect(alicePayouts).toHaveLength(1);
    expect(alicePayouts[0].amountMsat).toBe(2_980_000);
    expect(alicePayouts[0].status).toBe("SENT");
    expect(alicePayouts[0].preimage).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles bonded disputes and admin arbitration upholding dispute, returning bond, and paying true winners", async () => {
    const mkt = await publishTrackBMarket(
      "Will the Senate pass the digital assets bill before 2026-12-31?",
    );
    await confirmBet(mkt.id, alicePubkey, "YES", 1_000);
    await confirmBet(mkt.id, bobPubkey, "NO", 2_000);

    const resolveTime = new Date(mkt.resolveAfter.getTime() + 1_000);
    await runOracleTick(db, { now: resolveTime, broadcastFn: async () => [] });

    const prop = await submitTrackBProposal(db, {
      marketIdOrSlug: mkt.id,
      nostrEvent: signProposal(signerSk, mkt, "YES"),
      now: resolveTime,
      allowedSigners: [signerPubkey],
      challengeWindowSec: 120,
      broadcastFn: async () => [],
    });
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;

    const disputeEvent = finalizeEvent(
      {
        kind: DISPUTE_EVENT_KIND,
        created_at: Math.floor((resolveTime.getTime() + 30_000) / 1000),
        tags: [
          ["d", `dispute:${mkt.slug}`],
          ["e", prop.proposal.id, "", "reply"],
          ["proof", "https://congress.gov/bill/rollcall-no"],
        ],
        content: "Official roll call shows bill did not pass.",
      },
      disputerSk,
    );

    const disp = await submitTrackBDispute(db, {
      marketIdOrSlug: mkt.id,
      nostrEvent: disputeEvent,
      now: new Date(resolveTime.getTime() + 30_000),
      broadcastFn: async () => [],
    });
    expect(disp.ok).toBe(true);
    if (!disp.ok) return;
    expect(disp.market.status).toBe("DISPUTED");
    expect(disp.bond_invoice.amount_sats).toBe(1000);

    // Unauthorized non-admin cannot rule
    const badRule = await ruleOnDispute(db, {
      disputeId: disp.dispute.id,
      adminPubkey: alicePubkey,
      outcome: "NO",
      allowedAdmins: [adminPubkey],
      broadcastFn: async () => [],
    });
    expect(badRule.ok).toBe(false);
    if (!badRule.ok) expect(badRule.status).toBe(403);

    // Admin rules NO (upholds dispute against YES proposal)
    const ruled = await ruleOnDispute(db, {
      disputeId: disp.dispute.id,
      adminPubkey,
      outcome: "NO",
      now: new Date(resolveTime.getTime() + 40_000),
      allowedAdmins: [adminPubkey],
      broadcastFn: async () => [],
    });
    expect(ruled.ok).toBe(true);
    if (!ruled.ok) return;

    expect(ruled.dispute.status).toBe("UPHELD");
    expect(ruled.proposal.status).toBe("REJECTED");
    expect(ruled.market.status).toBe("SETTLED");
    expect(ruled.market.outcome).toBe("NO");

    // Signer disputesLost incremented
    const signerRows = await db
      .select()
      .from(schema.signers)
      .where(eq(schema.signers.pubkey, signerPubkey));
    expect(signerRows[0].disputesLost).toBeGreaterThanOrEqual(1);

    // Bob (NO bettor) paid 2,980 sats; Disputer gets 1,000 sat BOND_RETURN
    const bobPayouts = await listUserPayoutsFromDb(db, bobPubkey, mkt.id);
    const dispPayouts = await listUserPayoutsFromDb(db, disputerPubkey, mkt.id);
    expect(bobPayouts[0].amountMsat).toBe(2_980_000);
    expect(bobPayouts[0].status).toBe("SENT");
    expect(dispPayouts[0].kind).toBe("BOND_RETURN");
    expect(dispPayouts[0].amountMsat).toBe(1_000_000);
    expect(dispPayouts[0].status).toBe("SENT");

    // Entire ledger across all markets still nets to 0
    const netSum = await db
      .select({ net: sql<number>`coalesce(sum(${schema.ledgerEntries.amountMsat}), 0)` })
      .from(schema.ledgerEntries);
    expect(Number(netSum[0].net)).toBe(0);
  });
});
