import { verifyEvent } from "nostr-tools/pure";
import { z } from "zod";
import { consumeChallenge } from "./session";

export { pubkeyToNpub, shortNpub } from "./npub";

export const LOGIN_EVENT_KIND = 27235;
const MAX_CLOCK_SKEW_SEC = 60;

const NostrEventSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/i),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/i),
  created_at: z.number().int().positive(),
  kind: z.literal(LOGIN_EVENT_KIND),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[0-9a-f]{128}$/i),
});

export type VerifyLoginResult =
  | { ok: true; pubkey: string }
  | { ok: false; error: string };

function findTag(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name && typeof t[1] === "string")?.[1];
}

/**
 * Verifies a NIP-98-style kind 27235 Nostr login event signed over our challenge.
 */
export function verifyLoginEvent(
  rawEvent: unknown,
  opts: { expectedPath?: string; nowMs?: number } = {},
): VerifyLoginResult {
  const parsed = NostrEventSchema.safeParse(rawEvent);
  if (!parsed.success) {
    return { ok: false, error: "Invalid Nostr login event format" };
  }

  const event = {
    ...parsed.data,
    id: parsed.data.id.toLowerCase(),
    pubkey: parsed.data.pubkey.toLowerCase(),
    sig: parsed.data.sig.toLowerCase(),
  };

  if (!verifyEvent(event)) {
    return { ok: false, error: "Invalid Nostr event signature" };
  }

  const nowMs = opts.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - event.created_at) > MAX_CLOCK_SKEW_SEC) {
    return { ok: false, error: "Login event timestamp is outside allowed window" };
  }

  const methodTag = findTag(event.tags, "method");
  if (methodTag !== "POST") {
    return { ok: false, error: "Login event must include method=POST tag" };
  }

  const expectedPath = opts.expectedPath ?? "/api/v1/auth/nostr";
  const urlTag = findTag(event.tags, "u");
  if (!urlTag) {
    return { ok: false, error: "Login event missing u tag" };
  }

  try {
    const parsedUrl = new URL(urlTag);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { ok: false, error: "Login event u tag must use http or https" };
    }
    if (!parsedUrl.pathname.endsWith(expectedPath)) {
      return { ok: false, error: "Login event u tag path mismatch" };
    }
  } catch {
    return { ok: false, error: "Login event u tag is not a valid URL" };
  }

  const challengeTag = findTag(event.tags, "challenge");
  if (!challengeTag || !consumeChallenge(challengeTag, nowMs)) {
    return { ok: false, error: "Invalid, expired, or replayed auth challenge" };
  }

  return { ok: true, pubkey: event.pubkey };
}
