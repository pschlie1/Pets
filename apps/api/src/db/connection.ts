import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

export type Db = Database.Database;

/**
 * Opens (or creates) the SQLite database and applies the schema idempotently.
 * Pass ':memory:' for tests. This is the only module that touches the driver,
 * so swapping to node:sqlite's DatabaseSync is a one-file change.
 */
export function getDb(dbPath: string = process.env.DB_PATH ?? 'connected-care.db'): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
