import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyTestMigrations } from "@/lib/db/test-migrations";

const SAVED_ENV = {
  DATABASE_URL: process.env.DATABASE_URL,
  DEMO_MODE: process.env.DEMO_MODE,
  LNBITS_URL: process.env.LNBITS_URL,
  LNBITS_INVOICE_KEY: process.env.LNBITS_INVOICE_KEY,
  LNBITS_ADMIN_KEY: process.env.LNBITS_ADMIN_KEY,
  LNBITS_WEBHOOK_SECRET: process.env.LNBITS_WEBHOOK_SECRET,
  ADMIN_PUBKEYS: process.env.ADMIN_PUBKEYS,
  ORACLE_SIGNER_PUBKEYS: process.env.ORACLE_SIGNER_PUBKEYS,
  NOSTR_PUBLISH_DISABLED: process.env.NOSTR_PUBLISH_DISABLED,
  CHALLENGE_WINDOW_SEC: process.env.CHALLENGE_WINDOW_SEC,
};

async function loginAs(
  appHandle: (req: Request) => Promise<Response>,
  sk: Uint8Array,
  isGuest: boolean,
): Promise<{
  token: string;
  pubkey: string;
  user: {
    pubkey: string;
    is_guest: boolean;
    is_admin?: boolean;
    account_mode?: string;
  };
}> {
  const chalRes = await appHandle(new Request("http://localhost/api/v1/auth/challenge"));
  expect(chalRes.status).toBe(200);
  const { challenge } = (await chalRes.json()) as { challenge: string };

  const ev = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["method", "POST"],
        ["u", "http://localhost/api/v1/auth/nostr"],
        ["challenge", challenge],
      ],
      content: "Demo Isolation Auth",
    },
    sk,
  );

  const authRes = await appHandle(
    new Request("http://localhost/api/v1/auth/nostr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: ev, is_guest: isGuest }),
    }),
  );
  expect(authRes.status).toBe(200);
  const json = (await authRes.json()) as {
    token: string;
    user: { pubkey: string; is_guest: boolean; is_admin?: boolean; account_mode?: string };
  };
  return { token: json.token, pubkey: json.user.pubkey, user: json.user };
}

describe("Production Demo Sandbox Isolation (DEMO_MODE=false)", () => {
  let tempDir = "";
  let app: typeof import("@/app")["app"];
  let db: typeof import("@/lib/db/client")["db"];
  let schema: typeof import("@/lib/db/client")["schema"];

  const demoSk = generateSecretKey();
  const demoChallengerSk = generateSecretKey();
  const demoSignerSk = generateSecretKey();
  const liveUserSk = generateSecretKey();
  const liveAdminSk = generateSecretKey();
  const liveAdminPubkey = getPublicKey(liveAdminSk).toLowerCase();

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitpredict-demo-iso-"));
    const dbFile = path.join(tempDir, "test.db");

    const initClient = createClient({ url: `file:${dbFile}` });
    await initClient.execute("PRAGMA foreign_keys = ON;");
    await applyTestMigrations(initClient);
    initClient.close();

    process.env.DATABASE_URL = `file:${dbFile}`;
    process.env.DEMO_MODE = "false";
    process.env.LNBITS_URL = "http://127.0.0.1:1";
    process.env.LNBITS_INVOICE_KEY = "prod-invoice-key";
    process.env.LNBITS_ADMIN_KEY = "prod-admin-key";
    process.env.LNBITS_WEBHOOK_SECRET = "prod-webhook-secret";
    process.env.ADMIN_PUBKEYS = liveAdminPubkey;
    process.env.ORACLE_SIGNER_PUBKEYS = liveAdminPubkey;
    process.env.NOSTR_PUBLISH_DISABLED = "true";
    process.env.CHALLENGE_WINDOW_SEC = "3600";

    const appMod = await import("@/app");
    const dbMod = await import("@/lib/db/client");
    app = appMod.app;
    db = dbMod.db;
    schema = dbMod.schema;
  });

  afterAll(() => {
    for (const [k, val] of Object.entries(SAVED_ENV)) {
      if (val === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = val;
      }
    }
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore Windows SQLite file lock until process exit
      }
    }
  });

  it("isolates Demo Sandbox vs Live markets, payouts, oracles, and health checks", async () => {
    const handle = (req: Request) => app.handle(req);

    const healthRes = await handle(new Request("http://localhost/health"));
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok: boolean; status: string };
    expect(healthJson.ok).toBe(true);
    expect(healthJson.status).toBe("healthy");

    const demoAuth = await loginAs(handle, demoSk, true);
    expect(demoAuth.user.is_guest).toBe(true);
    expect(demoAuth.user.is_admin).toBe(false);
    expect(demoAuth.user.account_mode).toBe("demo");

    const liveAuth = await loginAs(handle, liveUserSk, false);
    expect(liveAuth.user.is_guest).toBe(false);
    expect(liveAuth.user.is_admin).toBe(false);
    expect(liveAuth.user.account_mode).toBe("live");

    const adminAuth = await loginAs(handle, liveAdminSk, false);
    expect(adminAuth.user.is_guest).toBe(false);
    expect(adminAuth.user.is_admin).toBe(true);
    expect(adminAuth.user.account_mode).toBe("live");

    // Helper to draft & publish a market via HTTP routes
    async function createAndPublishMarket(token: string, prompt: string) {
      const draftRes = await handle(
        new Request("http://localhost/api/v1/markets/draft", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ prompt, timezone: "UTC" }),
        }),
      );
      expect(draftRes.status).toBe(201);
      const draft = (await draftRes.json()) as { draft_id: string };

      const pubRes = await handle(
        new Request("http://localhost/api/v1/markets", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ draft_id: draft.draft_id }),
        }),
      );
      expect(pubRes.status).toBe(201);
      const pubJson = (await pubRes.json()) as {
        market: { id: string; slug: string; isDemo: boolean; specSha256: string };
      };
      return pubJson.market;
    }

    const demoTrackA = await createAndPublishMarket(
      demoAuth.token,
      "Will Bitcoin reach $150,000 on Binance tomorrow?",
    );
    expect(demoTrackA.isDemo).toBe(true);

    const demoTrackB = await createAndPublishMarket(
      demoAuth.token,
      "Will Senate pass the federal digital assets bill tomorrow?",
    );
    expect(demoTrackB.isDemo).toBe(true);

    const demoTrackB2 = await createAndPublishMarket(
      demoAuth.token,
      "Will EU digital identity bill pass plenary vote tomorrow?",
    );
    expect(demoTrackB2.isDemo).toBe(true);

    const liveTrackA = await createAndPublishMarket(
      adminAuth.token,
      "Will bitcoin/bitcoin GitHub repo reach 95,000 stars tomorrow?",
    );
    expect(liveTrackA.isDemo).toBe(false);

    const liveTrackB = await createAndPublishMarket(
      adminAuth.token,
      "Will Parliament ratify the open payment standard tomorrow?",
    );
    expect(liveTrackB.isDemo).toBe(false);

    // Filter markets by mode=demo vs mode=live
    const demoListRes = await handle(new Request("http://localhost/api/v1/markets?mode=demo"));
    expect(demoListRes.status).toBe(200);
    const demoList = (await demoListRes.json()) as { markets: Array<{ id: string; isDemo: boolean }> };
    expect(demoList.markets.length).toBe(3);
    expect(demoList.markets.every((m) => m.isDemo === true)).toBe(true);

    const liveListRes = await handle(new Request("http://localhost/api/v1/markets?mode=live"));
    expect(liveListRes.status).toBe(200);
    const liveList = (await liveListRes.json()) as { markets: Array<{ id: string; isDemo: boolean }> };
    expect(liveList.markets.length).toBe(2);
    expect(liveList.markets.every((m) => m.isDemo === false)).toBe(true);

    // Enforce pool isolation: demo user cannot bet on live market; live user cannot bet on demo market
    const crossDemoBet = await handle(
      new Request(`http://localhost/api/v1/markets/${liveTrackA.id}/bets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${demoAuth.token}`,
        },
        body: JSON.stringify({ side: "YES", amount_sats: 1000 }),
      }),
    );
    expect(crossDemoBet.status).toBe(403);
    expect(((await crossDemoBet.json()) as { error: { code: string } }).error.code).toBe("MODE_MISMATCH");

    const crossLiveBet = await handle(
      new Request(`http://localhost/api/v1/markets/${demoTrackA.id}/bets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${liveAuth.token}`,
        },
        body: JSON.stringify({ side: "YES", amount_sats: 1000 }),
      }),
    );
    expect(crossLiveBet.status).toBe(403);
    expect(((await crossLiveBet.json()) as { error: { code: string } }).error.code).toBe("MODE_MISMATCH");

    // Demo user bets on Demo Track A market (simulated, never hits LNBITS_URL)
    const demoBetRes = await handle(
      new Request(`http://localhost/api/v1/markets/${demoTrackA.id}/bets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${demoAuth.token}`,
        },
        body: JSON.stringify({ side: "YES", amount_sats: 5000 }),
      }),
    );
    expect(demoBetRes.status).toBe(201);
    const demoBet = (await demoBetRes.json()) as {
      bet_id: string;
      bolt11: string;
      simulated: boolean;
      qr_data_url?: string | null;
    };
    expect(demoBet.simulated).toBe(true);
    expect(demoBet.bolt11.startsWith("lnbcsim")).toBe(true);
    expect(demoBet.qr_data_url).toBeNull();

    // Non-owner cannot confirm another user's bet
    const nonOwnerConfirm = await handle(
      new Request(`http://localhost/api/v1/bets/${demoBet.bet_id}/confirm`, {
        method: "POST",
        headers: { authorization: `Bearer ${liveAuth.token}` },
      }),
    );
    expect(nonOwnerConfirm.status).toBe(403);

    // Bet owner confirms simulated bet via /api/v1/bets/:id/confirm (no webhook secret needed)
    const confirmRes = await handle(
      new Request(`http://localhost/api/v1/bets/${demoBet.bet_id}/confirm`, {
        method: "POST",
        headers: { authorization: `Bearer ${demoAuth.token}` },
      }),
    );
    expect(confirmRes.status).toBe(200);
    const confirmJson = (await confirmRes.json()) as {
      ok: boolean;
      status: string;
      pool_yes_msat: number;
    };
    expect(confirmJson.ok).toBe(true);
    expect(confirmJson.status).toBe("CONFIRMED");
    expect(confirmJson.pool_yes_msat).toBe(5_000_000);

    // Instant resolve on Live market is strictly blocked when DEMO_MODE=false
    const illegalLiveResolve = await handle(
      new Request("http://localhost/api/v1/oracle/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market_id: liveTrackA.id, force_demo_resolve: true }),
      }),
    );
    expect(illegalLiveResolve.status).toBe(403);

    // Instant resolve on Demo Track A market works with DEMO_MODE=false (and settles payout)
    const demoResolve = await handle(
      new Request("http://localhost/api/v1/oracle/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market_id: demoTrackA.id, force_demo_resolve: true }),
      }),
    );
    expect(demoResolve.status).toBe(200);

    // Claim demo payout without providing a bolt11 invoice
    const demoPayoutsRes = await handle(
      new Request(`http://localhost/api/v1/me/payouts?market_id=${demoTrackA.id}`, {
        headers: { authorization: `Bearer ${demoAuth.token}` },
      }),
    );
    expect(demoPayoutsRes.status).toBe(200);
    const demoPayouts = (await demoPayoutsRes.json()) as {
      payouts: Array<{ id: string; status: string; market: { isDemo: boolean } }>;
    };
    expect(demoPayouts.payouts).toHaveLength(1);
    expect(demoPayouts.payouts[0].status).toBe("CLAIMABLE");
    expect(demoPayouts.payouts[0].market.isDemo).toBe(true);

    const claimDemoRes = await handle(
      new Request(`http://localhost/api/v1/payouts/${demoPayouts.payouts[0].id}/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${demoAuth.token}`,
        },
        body: JSON.stringify({}),
      }),
    );
    expect(claimDemoRes.status).toBe(200);
    const claimDemoJson = (await claimDemoRes.json()) as {
      payout: { status: string; bolt11: string };
    };
    expect(claimDemoJson.payout.status).toBe("SENT");
    expect(claimDemoJson.payout.bolt11.startsWith("lnbcsimclaim")).toBe(true);

    // Live payout without bolt11 must fail with 422 VALIDATION_FAILED
    const livePayoutId = crypto.randomUUID();
    await db.insert(schema.payouts).values({
      id: livePayoutId,
      marketId: liveTrackA.id,
      userPubkey: liveAuth.pubkey,
      kind: "WIN",
      amountMsat: 2_000_000,
      status: "CLAIMABLE",
      updatedAt: new Date(),
    });
    const claimLiveNoBolt = await handle(
      new Request(`http://localhost/api/v1/payouts/${livePayoutId}/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${liveAuth.token}`,
        },
        body: JSON.stringify({}),
      }),
    );
    expect(claimLiveNoBolt.status).toBe(422);

    // Track B Demo Propose -> Dispute -> Admin Ruling works for Demo user on Demo market
    const propEvent = finalizeEvent(
      {
        kind: 30079,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", `outcome:${demoTrackB.slug}`],
          ["outcome", "YES"],
          ["spec_sha256", demoTrackB.specSha256],
          ["proof", "https://bitpredict.local/proof/demo"],
        ],
        content: "Demo Track B proposal",
      },
      demoSignerSk,
    );
    const propRes = await handle(
      new Request(`http://localhost/api/v1/markets/${demoTrackB.id}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nostr_event: propEvent, force_ready_in_demo: true }),
      }),
    );
    expect(propRes.status).toBe(201);

    const dispEvent = finalizeEvent(
      {
        kind: 30080,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", `dispute:${demoTrackB.slug}`],
          ["e", propEvent.id, "", "reply"],
          ["proof", "https://bitpredict.local/dispute/demo"],
        ],
        content: "Demo dispute challenge",
      },
      demoChallengerSk,
    );
    const dispRes = await handle(
      new Request(`http://localhost/api/v1/markets/${demoTrackB.id}/disputes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nostr_event: dispEvent }),
      }),
    );
    expect(dispRes.status).toBe(201);
    const dispJson = (await dispRes.json()) as {
      dispute: { id: string };
      bond_invoice: { simulated: boolean };
    };
    expect(dispJson.bond_invoice.simulated).toBe(true);

    const demoRuleRes = await handle(
      new Request(`http://localhost/api/v1/admin/disputes/${dispJson.dispute.id}/rule`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${demoAuth.token}`,
        },
        body: JSON.stringify({ outcome: "NO" }),
      }),
    );
    expect(demoRuleRes.status).toBe(200);
    const demoRuleJson = (await demoRuleRes.json()) as {
      market: { status: string; outcome: string };
    };
    expect(demoRuleJson.market.outcome).toBe("NO");
    expect(["RESOLVED", "SETTLED"]).toContain(demoRuleJson.market.status);

    // Demo track B finalize shortcut succeeds for demoTrackB2
    const prop2Event = finalizeEvent(
      {
        kind: 30079,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", `outcome:${demoTrackB2.slug}`],
          ["outcome", "YES"],
          ["spec_sha256", demoTrackB2.specSha256],
          ["proof", "https://bitpredict.local/proof/demo2"],
        ],
        content: "Demo Track B proposal 2",
      },
      demoSignerSk,
    );
    expect(
      (
        await handle(
          new Request(`http://localhost/api/v1/markets/${demoTrackB2.id}/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nostr_event: prop2Event, force_ready_in_demo: true }),
          }),
        )
      ).status,
    ).toBe(201);

    const finalizeDemoRes = await handle(
      new Request("http://localhost/api/v1/oracle/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market_id: demoTrackB2.id, force_finalize_proposal: true }),
      }),
    );
    expect(finalizeDemoRes.status).toBe(200);

    // Live Track B dispute ruling & force finalize remain forbidden to demo users
    await db
      .update(schema.markets)
      .set({ status: "PENDING_RESOLUTION" })
      .where(eq(schema.markets.id, liveTrackB.id));
    const livePropEvent = finalizeEvent(
      {
        kind: 30079,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", `outcome:${liveTrackB.slug}`],
          ["outcome", "YES"],
          ["spec_sha256", liveTrackB.specSha256],
          ["proof", "https://example.org/official-record"],
        ],
        content: "Live Track B proposal",
      },
      liveAdminSk,
    );
    expect(
      (
        await handle(
          new Request(`http://localhost/api/v1/markets/${liveTrackB.id}/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nostr_event: livePropEvent }),
          }),
        )
      ).status,
    ).toBe(201);

    const illegalFinalizeLive = await handle(
      new Request("http://localhost/api/v1/oracle/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market_id: liveTrackB.id, force_finalize_proposal: true }),
      }),
    );
    expect(illegalFinalizeLive.status).toBe(403);

    const liveProposalId = (
      await db
        .select({ id: schema.proposals.id })
        .from(schema.proposals)
        .where(eq(schema.proposals.marketId, liveTrackB.id))
    )[0].id;
    const liveDisputeId = crypto.randomUUID();
    await db.insert(schema.disputes).values({
      id: liveDisputeId,
      proposalId: liveProposalId,
      disputerPubkey: liveAuth.pubkey,
      proofUrls: ["https://example.org/counter"],
      nostrEvent: { id: "d".repeat(64) },
      status: "OPEN",
      createdAt: new Date(),
    });
    const illegalDemoRuleOnLive = await handle(
      new Request(`http://localhost/api/v1/admin/disputes/${liveDisputeId}/rule`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${demoAuth.token}`,
        },
        body: JSON.stringify({ outcome: "NO" }),
      }),
    );
    expect(illegalDemoRuleOnLive.status).toBe(403);

    // Demo seeding works even when DEMO_MODE=false and marks seeded markets isDemo=true
    const seedRes = await handle(
      new Request("http://localhost/api/v1/demo/seed", { method: "POST" }),
    );
    expect(seedRes.status).toBe(200);
    const demoMarketsAfterSeed = await db
      .select()
      .from(schema.markets)
      .where(eq(schema.markets.isDemo, true));
    expect(demoMarketsAfterSeed.length).toBeGreaterThanOrEqual(6);

    // Bearer authorization overrides a stale session cookie of another mode
    const meOverrideRes = await handle(
      new Request("http://localhost/api/v1/me", {
        headers: {
          cookie: `bp_session=${demoAuth.token}`,
          authorization: `Bearer ${liveAuth.token}`,
        },
      }),
    );
    expect(meOverrideRes.status).toBe(200);
    const meOverrideJson = (await meOverrideRes.json()) as {
      user: { pubkey: string; is_guest: boolean };
    };
    expect(meOverrideJson.user.pubkey).toBe(liveAuth.pubkey);
    expect(meOverrideJson.user.is_guest).toBe(false);

    // Oracle queue scopes cleanly by ?mode=live vs ?mode=demo
    const [liveQueueRes, demoQueueRes] = await Promise.all([
      handle(new Request("http://localhost/api/v1/oracle/queue?include_open=true&mode=live")),
      handle(new Request("http://localhost/api/v1/oracle/queue?include_open=true&mode=demo")),
    ]);
    expect(liveQueueRes.status).toBe(200);
    expect(demoQueueRes.status).toBe(200);
    const liveQueueJson = (await liveQueueRes.json()) as {
      queue: Array<{ market: { id: string; isDemo: boolean } }>;
    };
    const demoQueueJson = (await demoQueueRes.json()) as {
      queue: Array<{ market: { id: string; isDemo: boolean } }>;
    };
    expect(liveQueueJson.queue.some((q) => q.market.id === liveTrackB.id)).toBe(true);
    expect(liveQueueJson.queue.every((q) => q.market.isDemo === false)).toBe(true);
    expect(demoQueueJson.queue.length).toBeGreaterThan(0);
    expect(demoQueueJson.queue.some((q) => q.market.id === liveTrackB.id)).toBe(false);
    expect(demoQueueJson.queue.every((q) => q.market.isDemo === true)).toBe(true);

    // Portfolio positions & payouts filter strictly by authenticated user mode
    const syntheticLiveBetId = crypto.randomUUID();
    const syntheticDemoBetId = crypto.randomUUID();
    await db.insert(schema.bets).values([
      {
        id: syntheticLiveBetId,
        marketId: liveTrackA.id,
        userPubkey: demoAuth.pubkey,
        side: "YES",
        amountMsat: 100_000,
        paymentHash: `h-${syntheticLiveBetId}`,
        bolt11: "lnbc100n1psynthlive",
        status: "CONFIRMED",
        paidAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: syntheticDemoBetId,
        marketId: demoTrackA.id,
        userPubkey: liveAuth.pubkey,
        side: "NO",
        amountMsat: 100_000,
        paymentHash: `h-${syntheticDemoBetId}`,
        bolt11: "lnbcsim100n1psynthdemo",
        status: "CONFIRMED",
        paidAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const syntheticLivePayoutId = crypto.randomUUID();
    const syntheticDemoPayoutId = crypto.randomUUID();
    await db.insert(schema.payouts).values([
      {
        id: syntheticLivePayoutId,
        marketId: liveTrackA.id,
        userPubkey: demoAuth.pubkey,
        kind: "WIN",
        amountMsat: 150_000,
        status: "CLAIMABLE",
        attempts: 0,
        updatedAt: new Date(),
      },
      {
        id: syntheticDemoPayoutId,
        marketId: demoTrackA.id,
        userPubkey: liveAuth.pubkey,
        kind: "WIN",
        amountMsat: 150_000,
        status: "CLAIMABLE",
        attempts: 0,
        updatedAt: new Date(),
      },
    ]);

    const [livePosRes, demoPosRes, livePayRes, demoPayRes] = await Promise.all([
      handle(
        new Request("http://localhost/api/v1/me/positions", {
          headers: { authorization: `Bearer ${liveAuth.token}` },
        }),
      ),
      handle(
        new Request("http://localhost/api/v1/me/positions", {
          headers: { authorization: `Bearer ${demoAuth.token}` },
        }),
      ),
      handle(
        new Request("http://localhost/api/v1/me/payouts", {
          headers: { authorization: `Bearer ${liveAuth.token}` },
        }),
      ),
      handle(
        new Request("http://localhost/api/v1/me/payouts", {
          headers: { authorization: `Bearer ${demoAuth.token}` },
        }),
      ),
    ]);
    expect(livePosRes.status).toBe(200);
    expect(demoPosRes.status).toBe(200);
    expect(livePayRes.status).toBe(200);
    expect(demoPayRes.status).toBe(200);

    const livePosJson = (await livePosRes.json()) as {
      positions: Array<{ bet_id: string; market: { isDemo: boolean } }>;
    };
    const demoPosJson = (await demoPosRes.json()) as {
      positions: Array<{ bet_id: string; market: { isDemo: boolean } }>;
    };
    const livePayJson = (await livePayRes.json()) as {
      payouts: Array<{ id: string; market: { isDemo: boolean } }>;
    };
    const demoPayJson = (await demoPayRes.json()) as {
      payouts: Array<{ id: string; market: { isDemo: boolean } }>;
    };
    expect(livePosJson.positions.every((p) => p.market.isDemo === false)).toBe(true);
    expect(livePosJson.positions.some((p) => p.bet_id === syntheticDemoBetId)).toBe(false);
    expect(demoPosJson.positions.every((p) => p.market.isDemo === true)).toBe(true);
    expect(demoPosJson.positions.some((p) => p.bet_id === syntheticLiveBetId)).toBe(false);
    expect(livePayJson.payouts.every((p) => p.market.isDemo === false)).toBe(true);
    expect(livePayJson.payouts.some((p) => p.id === syntheticDemoPayoutId)).toBe(false);
    expect(demoPayJson.payouts.every((p) => p.market.isDemo === true)).toBe(true);
    expect(demoPayJson.payouts.some((p) => p.id === syntheticLivePayoutId)).toBe(false);

    // Live bet returns 502 with clear LNbits configuration guidance when LNBITS_URL is unset
    const savedLnbitsUrl = process.env.LNBITS_URL;
    process.env.LNBITS_URL = "";
    try {
      const noLnbitsBetRes = await handle(
        new Request(`http://localhost/api/v1/markets/${liveTrackA.id}/bets`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${liveAuth.token}`,
          },
          body: JSON.stringify({ side: "YES", amount_sats: 1000 }),
        }),
      );
      expect(noLnbitsBetRes.status).toBe(502);
      const noLnbitsJson = (await noLnbitsBetRes.json()) as { error: { message: string } };
      expect(noLnbitsJson.error.message).toContain("LNBITS_URL");
      expect(noLnbitsJson.error.message).toContain("Demo Account");
    } finally {
      process.env.LNBITS_URL = savedLnbitsUrl;
    }
  });
});
