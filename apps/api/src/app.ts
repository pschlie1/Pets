import express, { type Express } from 'express';
import type { Db } from './db/connection';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errors';
import { agentRoutes } from './routes/agent';
import { breedRoutes } from './routes/breeds';
import { demoRoutes } from './routes/demo';
import { householdRoutes } from './routes/households';
import { insightRoutes } from './routes/insights';
import { telemetryRoutes } from './routes/telemetry';
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

  app.get('/v1/health', (_req, res) => {
    res.json({ data: { status: 'ok', tier: 'api', demo: true } });
  });

  // SSE stream: EventSource cannot set an Authorization header, so the
  // stream endpoint sits outside the bearer check (demo-acceptable; a
  // production stream would authenticate via cookie or signed URL).
  app.get('/v1/households/:id/stream', (req, res) => {
    hub.register(req.params.id, res);
  });

  app.use('/v1', requireAuth);
  app.use('/v1', householdRoutes(db));
  app.use('/v1', telemetryRoutes(db, onInsight));
  app.use('/v1', breedRoutes(db));
  app.use('/v1', insightRoutes(db));
  app.use('/v1', agentRoutes(db));
  app.use('/v1', demoRoutes(db, onInsight));

  app.use(errorHandler);
  return { app, hub };
}
