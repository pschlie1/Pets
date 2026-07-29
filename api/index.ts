import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vercel serverless entry: the whole Express API tier as one function.
 *
 * The apps/api workspace is ESM ("type": "module") while this root entry is
 * compiled as CommonJS by Vercel's builder — so the app is loaded via dynamic
 * import(), which works from CJS. The promise is cached at module scope, so
 * warm invocations of the same instance reuse the app and database.
 *
 * Deployment notes (see README "Deploying to Vercel"):
 * - /tmp is the only writable path in a Vercel function; the SQLite database
 *   seeds there on cold start (~1s) when empty.
 * - Each instance has its own database — state diverges across instances and
 *   resets on cold starts. Acceptable for a single-presenter demo; a persistent
 *   deployment uses hosted Postgres (the schema was written for it).
 */

type ExpressApp = (req: IncomingMessage, res: ServerResponse) => void;

let appPromise: Promise<ExpressApp> | null = null;

async function createApp(): Promise<ExpressApp> {
  const { buildApp } = await import('../apps/api/src/app');
  const { getDb } = await import('../apps/api/src/db/connection');
  const { REF, seedAll } = await import('../apps/api/src/db/seed/index');

  const db = getDb(process.env.DB_PATH ?? '/tmp/connected-care.db');
  if (!db.prepare('SELECT id FROM households WHERE id = ?').get(REF.householdId)) {
    seedAll(db);
  }
  return buildApp(db).app as unknown as ExpressApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  appPromise ??= createApp();
  const app = await appPromise;
  app(req, res);
}
