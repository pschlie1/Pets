import express, { type Express } from 'express';
import { verifyToken } from './auth/tokens';
import type { Db } from './db/connection';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errors';
import { agentRoutes } from './routes/agent';
import { authRoutes } from './routes/auth';
import { breedRoutes } from './routes/breeds';
import { containmentRoutes } from './routes/containment';
import { docsRoutes } from './routes/docs';
import { demoRoutes } from './routes/demo';
import { deviceRoutes } from './routes/devices';
import { engagementRoutes } from './routes/engagement';
import { householdRoutes } from './routes/households';
import { insightRoutes } from './routes/insights';
import { metaRoutes } from './routes/meta';
import { orderRoutes } from './routes/orders';
import { telemetryRoutes } from './routes/telemetry';
import { vetReportRoutes } from './routes/vetReport';
import { SseHub } from './sse/hub';

/**
 * App factory with an injectable database — tests run against ':memory:'.
 * NOTE: no compression middleware anywhere; it would buffer the SSE stream.
 */
export function buildApp(db: Db): { app: Express; hub: SseHub } {
  const app = express();
  const hub = new SseHub();
  const onInsight = (householdId: string, insight: unknown) => hub.broadcast(householdId, 'insight', insight);

  app.use(express.json({ limit: '1mb' }));

  // CORS: lets a presentation layer on ANY origin consume this API (the
  // bundled web app rides same-origin rewrites and never needs it). Bearer
  // auth still gates every tenant-scoped route — CORS only lets browsers ask.
  // PRODUCTION NOTE: set ALLOWED_ORIGINS to the real client origins.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((o) => o.trim());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/v1/health', (_req, res) => {
    res.json({ data: { status: 'ok', tier: 'api', demo: true } });
  });

  // Interactive API docs — public, like the docs of any real API.
  app.use(docsRoutes());

  // The client contract (public reference data for any presentation layer).
  app.use('/v1', metaRoutes());

  // SSE stream: EventSource cannot set an Authorization header, so the token
  // travels as a query parameter (a signed-URL pattern). The stream is forced
  // to the CALLER'S household claim — the path id must match it.
  app.get('/v1/households/:id/stream', (req, res) => {
    const claims = typeof req.query.token === 'string' ? verifyToken(req.query.token) : null;
    if (!claims) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'A valid token query parameter is required.' } });
      return;
    }
    if (claims.household_id !== req.params.id) {
      res.status(403).json({ error: { code: 'forbidden', message: 'This stream belongs to a different household.' } });
      return;
    }
    hub.register(claims.household_id, res);
  });

  // Pet profile photos: <img> tags cannot set an Authorization header either,
  // so the token travels as a query parameter (bearer also accepted). Same
  // tenant rule as everything else: the pet must be in the caller's household.
  app.get('/v1/pets/:id/photo', (req, res) => {
    const bearer = (req.headers.authorization ?? '').startsWith('Bearer ')
      ? (req.headers.authorization as string).slice(7)
      : null;
    const token = typeof req.query.token === 'string' ? req.query.token : bearer;
    const claims = token ? verifyToken(token) : null;
    if (!claims) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'A valid token is required.' } });
      return;
    }
    const pet = db
      .prepare(`SELECT household_id, photo FROM pets WHERE id = ? AND deleted_at IS NULL`)
      .get(req.params.id) as { household_id: string; photo: Buffer | null } | undefined;
    if (!pet) {
      res.status(404).json({ error: { code: 'not_found', message: 'Pet not found.' } });
      return;
    }
    if (pet.household_id !== claims.household_id) {
      res.status(403).json({ error: { code: 'forbidden', message: 'This pet belongs to a different household.' } });
      return;
    }
    if (!pet.photo) {
      res.status(404).json({ error: { code: 'not_found', message: 'No photo on this profile.' } });
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(pet.photo);
  });

  app.use('/v1', authRoutes(db));
  app.use('/v1', requireAuth);
  app.use('/v1', householdRoutes(db));
  app.use('/v1', containmentRoutes(db));
  app.use('/v1', engagementRoutes(db));
  app.use('/v1', orderRoutes(db));
  app.use('/v1', deviceRoutes(db));
  app.use('/v1', telemetryRoutes(db, onInsight));
  app.use('/v1', breedRoutes(db));
  app.use('/v1', insightRoutes(db));
  app.use('/v1', agentRoutes(db));
  app.use('/v1', vetReportRoutes(db));
  app.use('/v1', demoRoutes(db, onInsight));

  app.use(errorHandler);
  return { app, hub };
}
