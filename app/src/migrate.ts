import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

/** Runs all pending Drizzle SQL migrations using only runtime dependencies. */
async function main() {
  const url = process.env.DATABASE_URL ?? "file:./data/bitpredict.db";
  if (url.startsWith("file:") && !url.startsWith("file::memory:")) {
    const filePath = url.slice("file:".length).split("?")[0];
    if (filePath && filePath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(process.cwd(), filePath)), { recursive: true });
    }
  }

  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  });

  try {
    const db = drizzle(client);
    const migrationsFolder = path.resolve(process.cwd(), "drizzle");
    await migrate(db, { migrationsFolder });
    console.log(`Database migrations applied from ${migrationsFolder}`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("Database migration failed:", err);
  process.exit(1);
});
