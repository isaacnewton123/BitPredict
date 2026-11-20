import { Elysia, t } from "elysia";
import { validateLightningAddress } from "@/lib/auth/lightning-address";
import { verifyLoginEvent } from "@/lib/auth/nostr";
import {
  getCurrentUserFromRequest,
  updateUserLightningAddress,
  upsertUserOnLogin,
} from "@/lib/auth/server";
import {
  createSessionToken,
  issueChallenge,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { listUserPositionsFromDb } from "@/lib/payments/bet-repo";
import { listUserPayoutsFromDb } from "@/lib/payments/settlement-repo";
import { isAuthorizedAdmin } from "@/lib/oracle/track-b-repo";

function withAdminFlag<T extends { pubkey: string; is_guest: boolean }>(
  user: T,
): T & { is_admin: boolean; account_mode: "live" | "demo" };
function withAdminFlag<T extends { pubkey: string; is_guest: boolean }>(
  user: T | null,
): (T & { is_admin: boolean; account_mode: "live" | "demo" }) | null;
function withAdminFlag<T extends { pubkey: string; is_guest: boolean }>(
  user: T | null,
): (T & { is_admin: boolean; account_mode: "live" | "demo" }) | null {
  if (!user) return null;
  return {
    ...user,
    is_admin: !user.is_guest && isAuthorizedAdmin(user.pubkey),
    account_mode: user.is_guest ? "demo" : "live",
  };
}

function parseNostrAuthHeader(header: string | null): unknown {
  if (!header) return null;
  const match = /^Nostr\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export const authRoutes = new Elysia({ name: "bitpredict-auth", tags: ["Auth & Profile"] })
  .get(
    "/api/v1/auth/challenge",
    ({ set }) => {
      set.headers["cache-control"] = "no-store";
      return issueChallenge();
    },
    {
      detail: {
        summary: "Issue Nostr login challenge",
        description: "Returns a single-use NIP-98 / kind 27235 challenge string valid for 60s.",
        tags: ["Auth & Profile"],
      },
    },
  )
  .post(
    "/api/v1/auth/nostr",
    async ({ request, body, cookie, set }) => {
      let rawEvent: unknown = parseNostrAuthHeader(request.headers.get("authorization"));
      let isGuest = false;

      if (body && typeof body === "object") {
        const b = body as { event?: unknown; is_guest?: unknown };
        if (!rawEvent && b.event !== undefined) rawEvent = b.event;
        isGuest = Boolean(b.is_guest);
      }

      const verified = verifyLoginEvent(rawEvent, { expectedPath: "/api/v1/auth/nostr" });
      if (!verified.ok) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: verified.error } };
      }

      const user = await upsertUserOnLogin(verified.pubkey, isGuest);
      const token = createSessionToken(user.pubkey, user.is_guest);
      cookie[SESSION_COOKIE_NAME].set({
        value: token,
        ...sessionCookieOptions(),
      });

      return { user: withAdminFlag(user), token };
    },
    {
      body: t.Optional(
        t.Object({
          event: t.Optional(t.Any()),
          is_guest: t.Optional(t.Boolean()),
        }),
      ),
      detail: {
        summary: "Verify Nostr login event & start session",
        description:
          "Accepts a signed kind 27235 Nostr event via JSON body or Authorization: Nostr <base64> header and sets an HTTP-only HMAC session cookie.",
        tags: ["Auth & Profile"],
      },
    },
  )
  .post(
    "/api/v1/auth/logout",
    ({ cookie }) => {
      cookie[SESSION_COOKIE_NAME].set({
        value: "",
        ...sessionCookieOptions(0),
      });
      return { ok: true };
    },
    {
      detail: {
        summary: "Clear active session cookie",
        tags: ["Auth & Profile"],
      },
    },
  )
  .get(
    "/api/v1/me",
    async ({ request, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Not logged in" } };
      }
      set.headers["cache-control"] = "no-store";
      return { user: withAdminFlag(user) };
    },
    {
      detail: {
        summary: "Get current authenticated user profile",
        tags: ["Auth & Profile"],
      },
    },
  )
  .patch(
    "/api/v1/me",
    async ({ request, body, set }) => {
      const current = await getCurrentUserFromRequest(request);
      if (!current) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Not logged in" } };
      }

      const rawAddress = body.lightning_address?.trim() ?? "";
      if (!rawAddress) {
        const updated = await updateUserLightningAddress(current.pubkey, null);
        return { user: withAdminFlag(updated), verified_remote: false, warning: null };
      }

      const validation = await validateLightningAddress(rawAddress, {
        allowDemoFallback: current.is_guest,
      });
      if (!validation.ok) {
        set.status = 422;
        return { error: { code: "VALIDATION_FAILED", message: validation.error } };
      }

      const updated = await updateUserLightningAddress(current.pubkey, validation.address);
      return {
        user: withAdminFlag(updated),
        verified_remote: validation.verifiedRemote,
        warning: validation.warning ?? null,
      };
    },
    {
      body: t.Object({
        lightning_address: t.Union([t.String({ maxLength: 120 }), t.Null()]),
      }),
      detail: {
        summary: "Update LUD-16 Lightning payout address",
        description: "Validates SSRF safety & remote LNURL-pay endpoint when non-empty.",
        tags: ["Auth & Profile"],
      },
    },
  )
  .get(
    "/api/v1/me/positions",
    async ({ request, query, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Not logged in" } };
      }
      set.headers["cache-control"] = "no-store";
      const positions = await listUserPositionsFromDb(db, user.pubkey, query.market_id, user.is_guest);
      return { positions };
    },
    {
      query: t.Object({
        market_id: t.Optional(t.String()),
      }),
      detail: {
        summary: "List authenticated user's bets & positions",
        tags: ["Auth & Profile"],
      },
    },
  )
  .get(
    "/api/v1/me/payouts",
    async ({ request, query, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Not logged in" } };
      }
      set.headers["cache-control"] = "no-store";
      const payouts = await listUserPayoutsFromDb(db, user.pubkey, query.market_id, user.is_guest);
      return { payouts };
    },
    {
      query: t.Object({
        market_id: t.Optional(t.String()),
      }),
      detail: {
        summary: "List authenticated user's payouts & claim statuses",
        tags: ["Auth & Profile"],
      },
    },
  );
