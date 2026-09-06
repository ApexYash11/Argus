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
