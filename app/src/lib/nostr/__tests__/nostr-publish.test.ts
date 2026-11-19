import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as nip19 from "nostr-tools/nip19";
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileMarketPrompt } from "@/lib/ai/compiler";
import * as schema from "@/lib/db/schema";
import { computeSpecSha256, sha256Hex } from "@/lib/domain/spec-hash";
import { createMarketDraft } from "@/lib/markets/draft-repo";
import {
  getMarketEventsFromDb,
  publishMarketDraft,
  queryMarkets,
} from "@/lib/markets/publish-repo";
import {
  buildMarketAnnouncementEvent,
  buildMarketSpecEvent,
  encodeMarketPointers,
  MARKET_SPEC_KIND,
  TEXT_NOTE_KIND,
} from "@/lib/nostr/events";

const MIGRATION_PATH = path.resolve(process.cwd(), "drizzle/0000_mute_may_parker.sql");
const FIXED_NOW = new Date("2026-11-19T12:00:00Z");

describe("Nostr market event builders & NIP-19 pointers", () => {
  it("builds valid signed kind 30078 spec event and kind 1 announcement note", async () => {
    const compiled = await compileMarketPrompt({
      prompt: "Will the maximum temperature in Washington city reach 19°C tomorrow?",
      timezone: "America/New_York",
      now: FIXED_NOW,
      apiKey: "",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const platformSk = generateSecretKey();
    const platformPubkey = getPublicKey(platformSk).toLowerCase();
    const creatorPubkey = getPublicKey(generateSecretKey()).toLowerCase();
    const slug = "washington-temp-19c-abc123";

    const specEvent = buildMarketSpecEvent({
      slug,
      spec: compiled.spec,
      specSha256: compiled.specSha256,
      creatorPubkey,
      secretKey: platformSk,
      createdAtSec: Math.floor(FIXED_NOW.getTime() / 1000),
    });

    expect(specEvent.kind).toBe(MARKET_SPEC_KIND);
    expect(verifyEvent(specEvent)).toBe(true);
    expect(sha256Hex(specEvent.content)).toBe(compiled.specSha256);
    expect(computeSpecSha256(JSON.parse(specEvent.content))).toBe(compiled.specSha256);

    const tagMap = new Map(specEvent.tags.map((t) => [t[0], t[1]]));
    expect(tagMap.get("d")).toBe(`market:${slug}`);
    expect(tagMap.get("category")).toBe("Weather");
    expect(tagMap.get("track")).toBe("auto_api");
    expect(tagMap.get("spec_sha256")).toBe(compiled.specSha256);
    expect(tagMap.get("p")).toBe(creatorPubkey);
    expect(Number(tagMap.get("cutoff"))).toBeGreaterThan(0);
    expect(Number(tagMap.get("deadline"))).toBeGreaterThanOrEqual(Number(tagMap.get("cutoff")));

    const noteEvent = buildMarketAnnouncementEvent({
      slug,
      spec: compiled.spec,
      platformPubkey,
      appUrl: "https://bitpredict.test",
      secretKey: platformSk,
      createdAtSec: Math.floor(FIXED_NOW.getTime() / 1000),
    });

    expect(noteEvent.kind).toBe(TEXT_NOTE_KIND);
    expect(verifyEvent(noteEvent)).toBe(true);
    expect(noteEvent.tags).toContainEqual(["t", "predictionmarket"]);
    expect(noteEvent.tags).toContainEqual(["t", "weather"]);
    expect(noteEvent.tags).toContainEqual(["a", `30078:${platformPubkey}:market:${slug}`]);
    expect(noteEvent.tags).toContainEqual(["r", `https://bitpredict.test/m/${slug}`]);

    const pointers = encodeMarketPointers({
      noteId: noteEvent.id,
      slug,
      platformPubkey,
      relays: ["wss://relay.damus.io", "wss://nos.lol"],
    });
    expect(pointers.nevent.startsWith("nevent1")).toBe(true);
    expect(pointers.naddr.startsWith("naddr1")).toBe(true);

    const decodedNevent = nip19.decode(pointers.nevent);
    expect(decodedNevent.type).toBe("nevent");
    if (decodedNevent.type === "nevent") {
      expect(decodedNevent.data.id).toBe(noteEvent.id);
    }

    const decodedNaddr = nip19.decode(pointers.naddr);
    expect(decodedNaddr.type).toBe("naddr");
    if (decodedNaddr.type === "naddr") {
      expect(decodedNaddr.data.kind).toBe(30078);
      expect(decodedNaddr.data.identifier).toBe(`market:${slug}`);
    }
  });
});

describe("publishMarketDraft & queryMarkets", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  const creatorSk = generateSecretKey();
  const creatorPubkey = getPublicKey(creatorSk).toLowerCase();
  const otherPubkey = getPublicKey(generateSecretKey()).toLowerCase();
  const platformSk = generateSecretKey();

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
    await db.insert(schema.users).values([{ pubkey: creatorPubkey }, { pubkey: otherPubkey }]);
  });

  afterAll(() => {
    client.close();
  });

  it("publishes a DRAFT to OPEN, stores Nostr events, and enforces all guards", async () => {
    const compiled = await compileMarketPrompt({
      prompt: "Will the maximum temperature in Washington city reach 19°C tomorrow?",
      timezone: "America/New_York",
      now: FIXED_NOW,
      apiKey: "",
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const draft = await createMarketDraft(db, {
      creatorPubkey,
      prompt: "Will the maximum temperature in Washington city reach 19°C tomorrow?",
      timezone: "America/New_York",
      compiled,
    });

    // 1) Missing draft -> 404
    const missing = await publishMarketDraft(db, {
      draftId: "00000000-0000-4000-8000-000000000000",
      creatorPubkey,
      now: FIXED_NOW,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.status).toBe(404);

    // 2) Non-owner -> 403
    const forbidden = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey: otherPubkey,
      now: FIXED_NOW,
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.status).toBe(403);

    // 3) Tampered creator signature event -> 422
    const creatorSig = finalizeEvent(
      {
        kind: 27235,
        created_at: Math.floor(FIXED_NOW.getTime() / 1000),
        tags: [
          ["d", draft.draft_id],
          ["spec_sha256", draft.spec_sha256],
        ],
        content: "Publish market",
      },
      creatorSk,
    );
    const tamperedSig = {
      ...creatorSig,
      sig: `${creatorSig.sig.slice(0, -1)}${creatorSig.sig.endsWith("0") ? "1" : "0"}`,
    };
    const badSigRes = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      creatorSignatureEvent: tamperedSig,
      now: FIXED_NOW,
    });
    expect(badSigRes.ok).toBe(false);
    if (!badSigRes.ok) expect(badSigRes.status).toBe(422);

    // 4) Expired draft (now past betting_cutoff) -> 422
    const expiredRes = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      now: new Date("2026-11-21T00:00:00Z"),
    });
    expect(expiredRes.ok).toBe(false);
    if (!expiredRes.ok) expect(expiredRes.status).toBe(422);

    // 5) Valid publish with mocked relay broadcaster
    const broadcastCalls: number[] = [];
    const published = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      creatorSignatureEvent: creatorSig,
      now: FIXED_NOW,
      platformSecretKey: platformSk,
      broadcastFn: async (ev, relays) => {
        broadcastCalls.push(ev.kind);
        return relays.slice(0, 2);
      },
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    expect(published.market.status).toBe("OPEN");
    expect(published.market.nostrNoteId).toBe(published.nostr.note_id);
    expect(broadcastCalls.sort()).toEqual([1, 30078]);
    expect(published.nostr.relays_ok).toHaveLength(2);

    const storedEvents = await getMarketEventsFromDb(db, draft.draft_id);
    expect(storedEvents).toHaveLength(3); // 30078, 27235 (creator), 1
    expect(storedEvents.map((e) => e.kind)).toContain(30078);
    expect(storedEvents.map((e) => e.kind)).toContain(1);
    expect(storedEvents.map((e) => e.kind)).toContain(27235);

    // 6) Re-publishing -> 409
    const republish = await publishMarketDraft(db, {
      draftId: draft.draft_id,
      creatorPubkey,
      now: FIXED_NOW,
    });
    expect(republish.ok).toBe(false);
    if (!republish.ok) expect(republish.status).toBe(409);
  });

  it("queries and sorts markets by category, status, track, trending, and closing", async () => {
    const btcCompiled = await compileMarketPrompt({
      prompt: "Will BTC be above $100,000 in 5 minutes?",
      now: FIXED_NOW,
      apiKey: "",
    });
    const polCompiled = await compileMarketPrompt({
      prompt: "Will the Senate pass the digital assets bill before 2026-12-31?",
      now: FIXED_NOW,
      apiKey: "",
    });
    expect(btcCompiled.ok && polCompiled.ok).toBe(true);
    if (!btcCompiled.ok || !polCompiled.ok) return;

    const dBtc = await createMarketDraft(db, {
      creatorPubkey,
      prompt: "Will BTC be above $100,000 in 5 minutes?",
      compiled: btcCompiled,
    });
    const dPol = await createMarketDraft(db, {
      creatorPubkey,
      prompt: "Will the Senate pass the digital assets bill before 2026-12-31?",
      compiled: polCompiled,
    });
    // Also keep an unpublished DRAFT to verify queryMarkets excludes DRAFT
    await createMarketDraft(db, {
      creatorPubkey,
      prompt: "Will Ethereum exceed $4,500 on 2026-12-15?",
      compiled: btcCompiled,
    });

    const noopBroadcast = async () => [];
    await publishMarketDraft(db, {
      draftId: dBtc.draft_id,
      creatorPubkey,
      now: FIXED_NOW,
      platformSecretKey: platformSk,
      broadcastFn: noopBroadcast,
    });
    await publishMarketDraft(db, {
      draftId: dPol.draft_id,
      creatorPubkey,
      now: FIXED_NOW,
      platformSecretKey: platformSk,
      broadcastFn: noopBroadcast,
    });

    // Give Politics market higher pool to verify sort=trending
    await db
      .update(schema.markets)
      .set({ poolYesMsat: 5_000_000, poolNoMsat: 3_000_000 })
      .where(eq(schema.markets.id, dPol.draft_id));

    const allListed = await queryMarkets(db, {});
    expect(allListed.every((m) => m.status !== "DRAFT")).toBe(true);
    expect(allListed.length).toBe(3); // Washington + BTC + Politics

    const onlyAuto = await queryMarkets(db, { track: "auto_api" });
    expect(onlyAuto.every((m) => m.track === "auto_api")).toBe(true);
    expect(onlyAuto.length).toBe(2);

    const onlyPolitics = await queryMarkets(db, { category: "Politics", status: "OPEN" });
    expect(onlyPolitics).toHaveLength(1);
    expect(onlyPolitics[0].id).toBe(dPol.draft_id);

    const trending = await queryMarkets(db, { sort: "trending" });
    expect(trending[0].id).toBe(dPol.draft_id);

    const closing = await queryMarkets(db, { sort: "closing" });
    expect(closing[0].id).toBe(dBtc.draft_id); // 5-minute BTC market closes soonest
  });
});
