import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "bp_session";
export const CHALLENGE_TTL_MS = 60_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ChallengePayload {
  challenge: string;
  expires_at: string;
}

export interface SessionPayload {
  sub: string;
  is_guest: boolean;
  iat: number;
  exp: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __bitpredictConsumedChallenges: Map<string, number> | undefined;
}

function getConsumedMap(): Map<string, number> {
  if (!globalThis.__bitpredictConsumedChallenges) {
    globalThis.__bitpredictConsumedChallenges = new Map();
  }
  return globalThis.__bitpredictConsumedChallenges;
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET environment variable must be set in production");
  }
  return "bitpredict-dev-only-secret-change-in-production";
}

function signHmac(data: string): string {
  return createHmac("sha256", getAuthSecret()).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Issues a 60-second HMAC-signed single-use auth challenge. */
export function issueChallenge(nowMs = Date.now()): ChallengePayload {
  const nonce = randomBytes(16).toString("hex");
  const expiresAtMs = nowMs + CHALLENGE_TTL_MS;
  const body = `${nonce}.${expiresAtMs}`;
  const sig = signHmac(body);
  return {
    challenge: `${body}.${sig}`,
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

/** Verifies and atomically consumes a challenge so it cannot be replayed. */
export function consumeChallenge(challenge: string, nowMs = Date.now()): boolean {
  const parts = challenge.split(".");
  if (parts.length !== 3) return false;

  const [nonce, expiresStr, sig] = parts;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^\d+$/.test(expiresStr) || !sig) {
    return false;
  }

  const expiresAtMs = Number(expiresStr);
  if (!Number.isSafeInteger(expiresAtMs) || nowMs > expiresAtMs) {
    return false;
  }

  const expectedSig = signHmac(`${nonce}.${expiresStr}`);
  if (!safeEqual(sig, expectedSig)) {
    return false;
  }

  const consumed = getConsumedMap();
  for (const [key, exp] of consumed.entries()) {
    if (exp < nowMs) consumed.delete(key);
  }
  if (consumed.has(nonce)) {
    return false;
  }
  consumed.set(nonce, expiresAtMs);
  return true;
}

export function createSessionToken(pubkey: string, isGuest: boolean, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + Math.floor(SESSION_TTL_MS / 1000);
  const payload: SessionPayload = {
    sub: pubkey.toLowerCase(),
    is_guest: isGuest,
    iat,
    exp,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signHmac(encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string, nowMs = Date.now()): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = signHmac(encoded);
  if (!safeEqual(sig, expectedSig)) return null;

  try {
    const raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      typeof raw.sub !== "string" ||
      !/^[0-9a-f]{64}$/.test(raw.sub) ||
      typeof raw.is_guest !== "boolean" ||
      typeof raw.iat !== "number" ||
      typeof raw.exp !== "number"
    ) {
      return null;
    }
    const nowSec = Math.floor(nowMs / 1000);
    if (nowSec >= raw.exp) return null;
    return {
      sub: raw.sub,
      is_guest: raw.is_guest,
      iat: raw.iat,
      exp: raw.exp,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSec = Math.floor(SESSION_TTL_MS / 1000)) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: isProd ? ("none" as const) : ("lax" as const),
    path: "/",
    secure: isProd,
    maxAge: maxAgeSec,
  };
}
