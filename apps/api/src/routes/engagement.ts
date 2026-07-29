import { Router, type Request } from 'express';
import { DEALERS, type DealerStatus, type DispatchStep } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { getMilestones } from '../engine/milestones';
import { getPeaceOfMindScore } from '../engine/score';
import { assertHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';
import { buildBriefing } from '../reports/briefing';

/**
 * Engagement surfaces: the daily briefing, the Peace-of-Mind score, and
 * milestones — the retention loop, all computed live from the same data the
 * rest of the app renders.
 */
export function engagementRoutes(db: Db): Router {
  const r = Router();

  const requireHousehold = (req: Request): void => {
    assertHousehold(req, req.params.id);
    const household = db.prepare(`SELECT id FROM households WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
    if (!household) throw new ApiError(404, 'not_found', 'Household not found.');
  };

  r.get('/households/:id/briefing', (req, res, next) => {
    try {
      requireHousehold(req);
      void buildBriefing(db, req.params.id)
        .then((briefing) => res.json({ data: briefing }))
        .catch(next);
    } catch (e) {
      next(e);
    }
  });

  r.get('/households/:id/score', (req, res) => {
    requireHousehold(req);
    res.json({ data: getPeaceOfMindScore(db, req.params.id) });
  });

  r.get('/households/:id/milestones', (req, res) => {
    requireHousehold(req);
    res.json({ data: getMilestones(db, req.params.id) });
  });

  // The dealer-network moat: who serves this household, plus live dispatch
  // state when an emergency insight has been routed to the associate queue.
  // The dispatch steps advance deterministically with elapsed time — the demo
  // stand-in for the dealer CRM's real status feed.
  r.get('/households/:id/dealer', (req, res) => {
    requireHousehold(req);
    const routed = db
      .prepare(
        `SELECT id, summary, generated_at FROM insights
         WHERE household_id = ? AND routed_to_associate = 1
           AND acknowledged_status IN ('unseen', 'seen')
         ORDER BY generated_at DESC LIMIT 1`,
      )
      .get(req.params.id) as { id: string; summary: string; generated_at: string } | undefined;

    let dispatch: DealerStatus['dispatch'] = null;
    if (routed) {
      const minutes = (Date.now() - Date.parse(routed.generated_at)) / 60_000;
      const step: DispatchStep = minutes < 2 ? 'alerted' : minutes < 10 ? 'reviewing' : 'followed_up';
      dispatch = { insight_id: routed.id, summary: routed.summary, routed_at: routed.generated_at, step };
    }

    const status: DealerStatus = {
      household_id: req.params.id,
      dealer: DEALERS[req.params.id] ?? null,
      dispatch,
    };
    res.json({ data: status });
  });

  return r;
}
