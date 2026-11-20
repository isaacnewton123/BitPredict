import { db } from "@/lib/db/client";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";
import {
  findUserByPubkey,
  updateUserLightningAddress as updateRepoAddress,
  upsertUserOnLogin as upsertRepoUser,
  type UserProfile,
} from "./user-repo";

export type { UserProfile } from "./user-repo";

export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      const rawVal = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

export async function getCurrentUser(sessionToken?: string | null): Promise<UserProfile | null> {
  if (!sessionToken) return null;
  const session = verifySessionToken(sessionToken);
  if (!session) return null;
  return findUserByPubkey(db, session.sub);
}

export async function getCurrentUserFromRequest(request: Request): Promise<UserProfile | null> {
  const auth = request.headers.get("authorization")?.trim();
  if (auth && /^Bearer\s+(.+)$/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const user = await getCurrentUser(token);
    if (user) {
      return user;
    }
  }
  const cookieToken = parseCookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (cookieToken) {
    return getCurrentUser(cookieToken);
  }
  return null;
}

export async function upsertUserOnLogin(pubkey: string, isGuest: boolean): Promise<UserProfile> {
  return upsertRepoUser(db, pubkey, isGuest);
}

export async function updateUserLightningAddress(
  pubkey: string,
  lightningAddress: string | null,
): Promise<UserProfile | null> {
  return updateRepoAddress(db, pubkey, lightningAddress);
}
