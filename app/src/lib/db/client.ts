import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __bitpredictDb: { client: Client; db: LibSQLDatabase<typeof schema> } | undefined;
}

function create() {
  const client = createClient({
    url: process.env.DATABASE_URL ?? "file:./data/bitpredict.db",
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });
  return { client, db: drizzle(client, { schema }) };
}

// Reuse a single connection across hot reloads in dev.
const instance = globalThis.__bitpredictDb ?? create();
if (process.env.NODE_ENV !== "production") globalThis.__bitpredictDb = instance;

export const db = instance.db;
export { schema };
