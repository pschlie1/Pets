import { Router } from 'express';
import { URGENCY_TIERS, urgencyRank, type Urgency } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { nowIso } from '../db/connection';
import { ApiError } from '../middleware/errors';

export function insightRoutes(db: Db): Router {
  const r = Router();

  r.get('/pets/:id/insights', (req, res) => {
    let rows = db
      .prepare(
        `SELECT * FROM insights WHERE pet_id = ? AND generated_at >= COALESCE(?, '') ORDER BY generated_at DESC LIMIT 100`,
      )
      .all(req.params.id, (req.query.since as string) ?? null) as { urgency: Urgency }[];
    const minUrgency = req.query.urgency as Urgency | undefined;
    if (minUrgency && (URGENCY_TIERS as readonly string[]).includes(minUrgency)) {
      rows = rows.filter((i) => urgencyRank(i.urgency) >= urgencyRank(minUrgency));
    }
    res.json({ data: rows });
  });

  // Household rollup — powers the peer-comparison view.
  r.get('/households/:id/insights', (req, res) => {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) ?? '20', 10) || 20, 1), 100);
    const petId = (req.query.pet_id as string) ?? null;
    const since = (req.query.since as string) ?? null;
    const minUrgency = req.query.urgency as Urgency | undefined;

    let rows = db
      .prepare(
        `SELECT * FROM insights WHERE household_id = ?
           AND (? IS NULL OR pet_id = ?)
           AND (? IS NULL OR generated_at >= ?)
         ORDER BY generated_at DESC`,
      )
      .all(req.params.id, petId, petId, since, since) as { urgency: Urgency }[];

    if (minUrgency && (URGENCY_TIERS as readonly string[]).includes(minUrgency)) {
      rows = rows.filter((i) => urgencyRank(i.urgency) >= urgencyRank(minUrgency));
    }

    const total = rows.length;
    const start = (page - 1) * limit;
    res.json({
      data: rows.slice(start, start + limit),
      pagination: { page, limit, total, total_pages: Math.max(Math.ceil(total / limit), 1) },
    });
  });

  function setStatus(id: string, status: 'acknowledged' | 'dismissed' | 'seen') {
    const row = db.prepare(`SELECT id FROM insights WHERE id = ?`).get(id);
    if (!row) throw new ApiError(404, 'not_found', 'Insight not found.');
    db.prepare(`UPDATE insights SET acknowledged_status = ?, acknowledged_at = ? WHERE id = ?`).run(
      status,
      status === 'seen' ? null : nowIso(),
      id,
    );
    return db.prepare(`SELECT * FROM insights WHERE id = ?`).get(id);
  }

  r.post('/insights/:id/acknowledge', (req, res) => res.json({ data: setStatus(req.params.id, 'acknowledged') }));
  r.post('/insights/:id/dismiss', (req, res) => res.json({ data: setStatus(req.params.id, 'dismissed') }));

  // Routes an insight to the dealer associate queue (no console UI in the demo —
  // the flag drives the "associate alerted" state in the owner app).
  r.post('/insights/:id/route', (req, res) => {
    const row = db.prepare(`SELECT id FROM insights WHERE id = ?`).get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', 'Insight not found.');
    db.prepare(`UPDATE insights SET routed_to_associate = 1 WHERE id = ?`).run(req.params.id);
    res.json({ data: db.prepare(`SELECT * FROM insights WHERE id = ?`).get(req.params.id) });
  });

  return r;
}
