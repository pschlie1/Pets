import { Router } from 'express';
import { vetShareSchema } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { activeInsights, buildVetReport, parseShare } from '../reports/vetReport';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

export function vetReportRoutes(db: Db): Router {
  const r = Router();

  r.get('/pets/:id/vet-report', async (req, res, next) => {
    try {
      const report = await buildVetReport(db, req.params.id);
      if (!report) throw new ApiError(404, 'not_found', 'Pet not found.');
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  // Records the digital hand-off. The server snapshots which insight ids were
  // active at share time; dedupe may later upgrade an insight in place, which
  // is fine — shares store ids, not content.
  // PRODUCTION NOTE: v2 integrates a real vet portal; the demo records and
  // confirms the share without external delivery.
  r.post('/pets/:id/vet-report/share', validate(vetShareSchema), (req, res) => {
    const pet = db
      .prepare(`SELECT id, household_id FROM pets WHERE id = ? AND deleted_at IS NULL`)
      .get(req.params.id) as { id: string; household_id: string } | undefined;
    if (!pet) throw new ApiError(404, 'not_found', 'Pet not found.');

    const id = uuid();
    const insightIds = activeInsights(db, pet.id).map((i) => i.id);
    db.prepare(
      `INSERT INTO vet_shares (id, household_id, pet_id, recipient, method, insight_ids) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, pet.household_id, pet.id, req.body.recipient, req.body.method, JSON.stringify(insightIds));

    const row = db.prepare(`SELECT * FROM vet_shares WHERE id = ?`).get(id) as Record<string, unknown>;
    res.status(201).json({ data: parseShare(row) });
  });

  return r;
}
