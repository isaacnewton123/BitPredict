import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "@/lib/db/schema";
import { pubkeyToNpub } from "./npub";

export interface UserProfile {
  pubkey: string;
  npub: string;
  lightning_address: string | null;
  is_guest: boolean;
}

export function toUserProfile(row: schema.User): UserProfile {
  return {
    pubkey: row.pubkey,
    npub: pubkeyToNpub(row.pubkey),
    lightning_address: row.lightningAddress ?? null,
    is_guest: row.isGuest,
  };
}

export async function findUserByPubkey(
  db: LibSQLDatabase<typeof schema>,
  pubkey: string,
): Promise<UserProfile | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.pubkey, pubkey.toLowerCase()))
    .limit(1);
  return rows[0] ? toUserProfile(rows[0]) : null;
}

export async function upsertUserOnLogin(
  db: LibSQLDatabase<typeof schema>,
  pubkey: string,
  isGuest: boolean,
): Promise<UserProfile> {
  const normalized = pubkey.toLowerCase();
  await db
    .insert(schema.users)
    .values({ pubkey: normalized, isGuest })
    .onConflictDoNothing({ target: schema.users.pubkey });

  const user = await findUserByPubkey(db, normalized);
  if (!user) throw new Error("Failed to load user after upsert");
  return user;
}

export async function updateUserLightningAddress(
  db: LibSQLDatabase<typeof schema>,
  pubkey: string,
  lightningAddress: string | null,
): Promise<UserProfile | null> {
  const normalized = pubkey.toLowerCase();
  await db
    .update(schema.users)
    .set({ lightningAddress })
    .where(eq(schema.users.pubkey, normalized));

  return findUserByPubkey(db, normalized);
}
