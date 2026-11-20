import fs from "node:fs";
import path from "node:path";
import type { Client } from "@libsql/client";

/** Executes all SQL migration files under app/drizzle in order on an isolated test client. */
export async function applyTestMigrations(client: Client): Promise<void> {
  const drizzleDir = path.resolve(process.cwd(), "drizzle");
  const files = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const raw = fs.readFileSync(path.join(drizzleDir, file), "utf8");
    const statements = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await client.execute(stmt);
    }
  }
}
