import { buildApp } from '../apps/api/src/app';
import { getDb } from '../apps/api/src/db/connection';
import { REF, seedAll } from '../apps/api/src/db/seed';

/**
 * Vercel serverless entry: the whole Express API tier as one function.
 * Module scope persists across warm invocations of the same instance.
 *
 * Deployment notes (see README "Deploying to Vercel"):
 * - /tmp is the only writable path in a Vercel function; the SQLite database
 *   seeds there on cold start (~1s) when empty.
 * - Each instance has its own database — state diverges across instances and
 *   resets on cold starts. Acceptable for a single-presenter demo; a persistent
 *   deployment uses hosted Postgres (the schema was written for it).
 */
const db = getDb(process.env.DB_PATH ?? '/tmp/connected-care.db');

if (!db.prepare('SELECT id FROM households WHERE id = ?').get(REF.householdId)) {
  seedAll(db);
}

const { app } = buildApp(db);

export default app;
