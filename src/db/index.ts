import { Database } from "bun:sqlite";
import { SCHEMA_SQL } from "./schema";
import path from "path";

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(workspaceDir: string): Database {
  if (db) closeDb();
  const dbPath = path.join(workspaceDir, ".audit", "spend-auditor.db");
  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA_SQL);
  // Migrations
  try { db.exec("ALTER TABLE findings ADD COLUMN recommendation TEXT"); } catch {}
  try { db.exec("ALTER TABLE calibration ADD COLUMN resolve_count INTEGER DEFAULT 0"); } catch {}
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Run fn inside a single SQLite transaction (bulk inserts go from ~30 rows/s to thousands). */
export function withTransaction<T>(fn: () => T, retries = 3): T {
  const d = getDb();
  let attempt = 0;
  for (;;) {
    try {
      d.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        d.exec("COMMIT");
        return result;
      } catch (err) {
        try { d.exec("ROLLBACK"); } catch { /* ignore */ }
        throw err;
      }
    } catch (err: any) {
      const busy = /locked|busy|busy_timeout/i.test(err?.message ?? "");
      if (busy && attempt < retries) {
        attempt++;
        const wait = 100 * 4 ** (attempt - 1);
        const start = Date.now();
        while (Date.now() - start < wait) { /* brief backoff */ }
        continue;
      }
      if (busy) {
        throw new Error(
          "database is locked — another argus process (audit, web, or chat) is likely still running. Close it and retry."
        );
      }
      throw err;
    }
  }
}
