import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from './app';
import { getDb } from './db/connection';
import { REF, seedAll } from './db/seed/index';

/**
 * Serverless handler source. At deploy time this file is bundled by esbuild
 * into a single self-contained CommonJS file (api/index.js) — no runtime
 * module resolution, no ESM/CJS boundary, no filesystem reads for the schema.
 * Only better-sqlite3 (native) and swagger-ui-dist (static assets) stay
 * external and are traced into the function bundle.
 *
 * Module scope persists across warm invocations of the same instance:
 * - /tmp is the only writable path in a Vercel function; the SQLite database
 *   seeds there on cold start (~1s) when empty.
 * - Each instance has its own database — state diverges across instances and
 *   resets on cold starts. Acceptable for a single-presenter demo; a
 *   persistent deployment uses hosted Postgres (the schema was written for it).
 */

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

let app: NodeHandler | null = null;

function getApp(): NodeHandler {
  if (!app) {
    const db = getDb(process.env.DB_PATH ?? '/tmp/connected-care.db');
    if (!db.prepare('SELECT id FROM households WHERE id = ?').get(REF.householdId)) {
      seedAll(db);
    }
    app = buildApp(db).app as unknown as NodeHandler;
  }
  return app;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  getApp()(req, res);
}
