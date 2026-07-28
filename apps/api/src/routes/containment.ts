import { Router } from 'express';
import type { Db } from '../db/connection';
import { getContainmentStatus, topUpBoundaryChecks } from '../engine/containment';
import { ApiError } from '../middleware/errors';

export function containmentRoutes(db: Db): Router {
  const r = Router();

  // Containment status for the Safety Center: boundary geometry, per-pet zone
  // state, collar health, and the boundary event timeline.
  r.get('/households/:id/containment', (req, res) => {
    const household = db.prepare(`SELECT id FROM households WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
    if (!household) throw new ApiError(404, 'not_found', 'Household not found.');
    const now = Date.now();
    topUpBoundaryChecks(db, req.params.id, now);
    res.json({ data: getContainmentStatus(db, req.params.id, now) });
  });

  return r;
}
