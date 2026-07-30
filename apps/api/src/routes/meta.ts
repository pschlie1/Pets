import { Router } from 'express';
import { buildClientMeta } from '@connected-care/shared';

/**
 * The client contract: metric catalog, urgency-tier language, score bands,
 * and thresholds — everything a presentation layer needs beyond tenant data.
 * Public reference data (no tenant content), served before auth so a new
 * client can bootstrap its UI before sign-in.
 */
export function metaRoutes(): Router {
  const r = Router();
  r.get('/meta', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ data: buildClientMeta() });
  });
  return r;
}
