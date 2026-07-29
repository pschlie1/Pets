import { Router, type Request } from 'express';
import type { Db } from '../db/connection';
import { getContainmentStatus, getDayHistory, getMovementHeatmap, topUpBoundaryChecks } from '../engine/containment';
import { assertHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';

export function containmentRoutes(db: Db): Router {
  const r = Router();

  const requireHousehold = (req: Request): void => {
    assertHousehold(req, req.params.id);
    const household = db.prepare(`SELECT id FROM households WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
    if (!household) throw new ApiError(404, 'not_found', 'Household not found.');
  };

  // Containment status for the Safety Center: boundary geometry, per-pet zone
  // state, collar health, and the boundary event timeline.
  r.get('/households/:id/containment', (req, res) => {
    requireHousehold(req);
    const now = Date.now();
    topUpBoundaryChecks(db, req.params.id, now);
    res.json({ data: getContainmentStatus(db, req.params.id, now) });
  });

  // Movement heat map: boundary_check positions binned over a period, per pet.
  r.get('/households/:id/containment/heatmap', (req, res) => {
    requireHousehold(req);
    const days = Number(req.query.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 21) {
      throw new ApiError(400, 'validation_error', 'days must be an integer between 1 and 21.');
    }
    const petId = typeof req.query.pet_id === 'string' ? req.query.pet_id : null;
    if (petId) {
      const pet = db.prepare(`SELECT household_id FROM pets WHERE id = ? AND deleted_at IS NULL`).get(petId) as
        | { household_id: string }
        | undefined;
      if (!pet) throw new ApiError(404, 'not_found', 'Pet not found.');
      assertHousehold(req, pet.household_id);
    }
    const now = Date.now();
    topUpBoundaryChecks(db, req.params.id, now);
    res.json({ data: getMovementHeatmap(db, req.params.id, days, petId, now) });
  });

  // Day review: everything each collared pet did on one household-local day.
  r.get('/households/:id/containment/history', (req, res) => {
    requireHousehold(req);
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const now = Date.now();
    topUpBoundaryChecks(db, req.params.id, now);
    const history = getDayHistory(db, req.params.id, date, now);
    if (!history) throw new ApiError(400, 'validation_error', 'date must be YYYY-MM-DD.');
    res.json({ data: history });
  });

  return r;
}
