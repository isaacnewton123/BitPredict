import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateLightningAddress } from "@/lib/auth/lightning-address";
import type { FetchLike } from "@/lib/domain/constants";
import { LOGIN_EVENT_KIND, pubkeyToNpub, shortNpub, verifyLoginEvent } from "@/lib/auth/nostr";
import {
  CHALLENGE_TTL_MS,
  consumeChallenge,
  createSessionToken,
  issueChallenge,
  SESSION_TTL_MS,
  verifySessionToken,
} from "@/lib/auth/session";
import { updateUserLightningAddress, upsertUserOnLogin } from "@/lib/auth/user-repo";
import * as schema from "@/lib/db/schema";
import { applyTestMigrations } from "@/lib/db/test-migrations";

function signLogin(
  sk: Uint8Array,
  challenge: string,
  overrides: {
    kind?: number;
    created_at?: number;
    method?: string;
    u?: string;
  } = {},
) {
  const unsigned = {
    kind: overrides.kind ?? LOGIN_EVENT_KIND,
    created_at: overrides.created_at ?? Math.floor(Date.now() / 1000),
    tags: [
      ["u", overrides.u ?? "https://bitpredict.test/api/v1/auth/nostr"],
      ["method", overrides.method ?? "POST"],
      ["challenge", challenge],
    ],
    content: "",
  };
  return finalizeEvent(unsigned, sk);
}

describe("issueChallenge & consumeChallenge", () => {
  it("consumes a valid challenge once and rejects replay", () => {
    const now = 1_700_000_000_000;
    const { challenge, expires_at } = issueChallenge(now);
    expect(Date.parse(expires_at)).toBe(now + CHALLENGE_TTL_MS);

    expect(consumeChallenge(challenge, now + 1_000)).toBe(true);
    expect(consumeChallenge(challenge, now + 2_000)).toBe(false);
  });

  it("rejects expired challenges", () => {
    const now = 1_700_000_000_000;
    const { challenge } = issueChallenge(now);
    expect(consumeChallenge(challenge, now + CHALLENGE_TTL_MS + 1)).toBe(false);
  });

  it("rejects tampered HMAC or malformed challenges", () => {
    const now = 1_700_000_000_000;
    const { challenge } = issueChallenge(now);
    const [nonce, exp, sig] = challenge.split(".");
    const tamperedSig = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(consumeChallenge(`${nonce}.${exp}.${tamperedSig}`, now)).toBe(false);
    expect(consumeChallenge("not-a-valid-challenge", now)).toBe(false);
  });
});

describe("verifyLoginEvent", () => {
  it("accepts a validly signed kind 27235 event and rejects replay", () => {
    const now = Date.now();
    const sk = generateSecretKey();
    const expectedPubkey = getPublicKey(sk).toLowerCase();
    const { challenge } = issueChallenge(now);
    const event = signLogin(sk, challenge, { created_at: Math.floor(now / 1000) });

    const first = verifyLoginEvent(event, { nowMs: now });
    expect(first).toEqual({ ok: true, pubkey: expectedPubkey });

    const replay = verifyLoginEvent(event, { nowMs: now });
    expect(replay.ok).toBe(false);
  });

  it("rejects tampered signature", () => {
    const now = Date.now();
    const sk = generateSecretKey();
    const { challenge } = issueChallenge(now);
    const event = signLogin(sk, challenge, { created_at: Math.floor(now / 1000) });
    const badSig = `${event.sig.slice(0, -1)}${event.sig.endsWith("0") ? "1" : "0"}`;

    const res = verifyLoginEvent({ ...event, sig: badSig }, { nowMs: now });
    expect(res.ok).toBe(false);
  });

  it("rejects wrong event kind", () => {
    const now = Date.now();
    const sk = generateSecretKey();
    const { challenge } = issueChallenge(now);
    const event = signLogin(sk, challenge, { kind: 1, created_at: Math.floor(now / 1000) });

    const res = verifyLoginEvent(event, { nowMs: now });
    expect(res.ok).toBe(false);
  });

  it("rejects stale timestamp outside 60s window", () => {
    const now = Date.now();
    const sk = generateSecretKey();
    const { challenge } = issueChallenge(now);
    const event = signLogin(sk, challenge, { created_at: Math.floor(now / 1000) - 120 });

    const res = verifyLoginEvent(event, { nowMs: now });
    expect(res.ok).toBe(false);
  });

  it("rejects wrong method or u tag path", () => {
    const now = Date.now();
    const sk = generateSecretKey();

    const c1 = issueChallenge(now).challenge;
    const wrongMethod = signLogin(sk, c1, { method: "GET", created_at: Math.floor(now / 1000) });
    expect(verifyLoginEvent(wrongMethod, { nowMs: now }).ok).toBe(false);

    const c2 = issueChallenge(now).challenge;
    const wrongUrl = signLogin(sk, c2, {
      u: "https://bitpredict.test/api/v1/other",
      created_at: Math.floor(now / 1000),
    });
    expect(verifyLoginEvent(wrongUrl, { nowMs: now }).ok).toBe(false);
  });

  it("formats npub and shortNpub consistently", () => {
    const pubkey = getPublicKey(generateSecretKey());
    const npub = pubkeyToNpub(pubkey);
    expect(npub.startsWith("npub1")).toBe(true);
    const short = shortNpub(npub);
    expect(short.startsWith("npub1")).toBe(true);
    expect(short.includes("…")).toBe(true);
  });
});

describe("createSessionToken & verifySessionToken", () => {
  it("verifies a valid token and rejects expired or tampered tokens", () => {
    const now = 1_700_000_000_000;
    const pubkey = getPublicKey(generateSecretKey());
    const token = createSessionToken(pubkey, true, now);

    const verified = verifySessionToken(token, now + 60_000);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe(pubkey.toLowerCase());
    expect(verified?.is_guest).toBe(true);

    // Expired after 7 days
    expect(verifySessionToken(token, now + SESSION_TTL_MS + 1_000)).toBeNull();

    // Tampered signature
    const [payload, sig] = token.split(".");
    const badSig = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(verifySessionToken(`${payload}.${badSig}`, now)).toBeNull();
  });
});

describe("validateLightningAddress", () => {
  it("validates a real LUD-16 payRequest payload via fetchFn", async () => {
    const mockFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          tag: "payRequest",
          callback: "https://wallet.example.com/lnurlp/cb",
          minSendable: 1000,
          maxSendable: 100_000_000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const res = await validateLightningAddress("  Satoshi@Wallet.Example.com ", { fetchFn: mockFetch });
    expect(res).toEqual({
      ok: true,
      address: "satoshi@wallet.example.com",
      verifiedRemote: true,
    });
  });

  it("rejects malformed Lightning Addresses", async () => {
    for (const bad of ["", "notanaddress", "foo@bar", "@domain.com", `${"a".repeat(115)}@domain.com`]) {
      const res = await validateLightningAddress(bad, { verifyRemote: false });
      expect(res.ok, `expected rejection for ${bad}`).toBe(false);
    }
  });

  it("blocks SSRF / internal Lightning Address hosts", async () => {
    const blocked = [
      "user@localhost",
      "user@127.0.0.1",
      "user@169.254.169.254",
      "user@192.168.1.1",
      "user@10.0.0.5",
      "user@172.16.0.1",
      "user@service.internal",
      "user@printer.local",
    ];
    for (const addr of blocked) {
      const res = await validateLightningAddress(addr, { verifyRemote: false });
      expect(res.ok, `expected SSRF rejection for ${addr}`).toBe(false);
    }
  });

  it("rejects invalid LNURL response payloads and unsafe callbacks", async () => {
    const wrongTagFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          tag: "withdrawRequest",
          callback: "https://wallet.example.com/cb",
          minSendable: 1000,
          maxSendable: 50_000,
        }),
        { status: 200 },
      );
    expect((await validateLightningAddress("a@wallet.example.com", { fetchFn: wrongTagFetch })).ok).toBe(false);

    const badBoundsFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          tag: "payRequest",
          callback: "https://wallet.example.com/cb",
          minSendable: 50_000,
          maxSendable: 1_000,
        }),
        { status: 200 },
      );
    expect((await validateLightningAddress("a@wallet.example.com", { fetchFn: badBoundsFetch })).ok).toBe(false);

    const ssrfCallbackFetch: FetchLike = async () =>
      new Response(
        JSON.stringify({
          tag: "payRequest",
          callback: "https://127.0.0.1/internal",
          minSendable: 1000,
          maxSendable: 50_000,
        }),
        { status: 200 },
      );
    expect((await validateLightningAddress("a@wallet.example.com", { fetchFn: ssrfCallbackFetch })).ok).toBe(false);

    const notFoundFetch: FetchLike = async () => new Response("Not found", { status: 404 });
    expect((await validateLightningAddress("a@wallet.example.com", { fetchFn: notFoundFetch })).ok).toBe(false);
  });
});

describe("User persistence (upsertUserOnLogin & updateUserLightningAddress)", () => {
  let client: Client;
  let db: LibSQLDatabase<typeof schema>;

  beforeAll(async () => {
    client = createClient({ url: ":memory:" });
    await client.execute("PRAGMA foreign_keys = ON;");
    await applyTestMigrations(client);
    db = drizzle(client, { schema });
  });

  afterAll(() => {
    client.close();
  });

  it("persists a user on login and updates/clears lightning_address", async () => {
    const pubkey = getPublicKey(generateSecretKey()).toLowerCase();

    const created = await upsertUserOnLogin(db, pubkey, true);
    expect(created).toEqual({
      pubkey,
      npub: pubkeyToNpub(pubkey),
      lightning_address: null,
      is_guest: true,
    });

    const updated = await updateUserLightningAddress(db, pubkey, "satoshi@getalby.com");
    expect(updated?.lightning_address).toBe("satoshi@getalby.com");

    // Re-logging in must preserve existing lightning_address
    const relogin = await upsertUserOnLogin(db, pubkey, true);
    expect(relogin.lightning_address).toBe("satoshi@getalby.com");

    const cleared = await updateUserLightningAddress(db, pubkey, null);
    expect(cleared?.lightning_address).toBeNull();
  });
});
