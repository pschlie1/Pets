import { Router } from 'express';
import { vetShareSchema, type VetShareStage, type VetShareWithStatus } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { activeInsights, buildVetReport, parseShare } from '../reports/vetReport';
import { assertHousehold, petHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

export function vetReportRoutes(db: Db): Router {
  const r = Router();

  r.get('/pets/:id/vet-report', async (req, res, next) => {
    try {
      assertHousehold(req, petHousehold(db, req.params.id));
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
    assertHousehold(req, pet.household_id);

    const id = uuid();
    const insightIds = activeInsights(db, pet.id).map((i) => i.id);
    db.prepare(
      `INSERT INTO vet_shares (id, household_id, pet_id, recipient, method, insight_ids) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, pet.household_id, pet.id, req.body.recipient, req.body.method, JSON.stringify(insightIds));

    const row = db.prepare(`SELECT * FROM vet_shares WHERE id = ?`).get(id) as Record<string, unknown>;
    res.status(201).json({ data: parseShare(row) });
  });

  // Share history with the delivery/review stage. Stages advance
  // deterministically with elapsed time since the share — the demo stand-in
  // for a real vet portal's read receipts and replies.
  r.get('/pets/:id/vet-report/shares', (req, res) => {
    const pet = db
      .prepare(`SELECT id, name, household_id FROM pets WHERE id = ? AND deleted_at IS NULL`)
      .get(req.params.id) as { id: string; name: string; household_id: string } | undefined;
    if (!pet) throw new ApiError(404, 'not_found', 'Pet not found.');
    assertHousehold(req, pet.household_id);

    const rows = db
      .prepare(`SELECT * FROM vet_shares WHERE pet_id = ? ORDER BY shared_at DESC`)
      .all(pet.id) as Record<string, unknown>[];
    const now = Date.now();
    const shares: VetShareWithStatus[] = rows.map((row) => {
      const share = parseShare(row);
      const minutes = (now - Date.parse(share.shared_at)) / 60_000;
      const stage: VetShareStage =
        minutes < 2 ? 'sent' : minutes < 5 ? 'delivered' : minutes < 8 ? 'viewed' : 'reviewed';
      return {
        ...share,
        stage,
        clinic_note:
          stage === 'reviewed'
            ? `Trend noted — bring ${pet.name} in if it persists this week. — Dr. Chen, ${share.recipient}`
            : null,
      };
    });
    res.json({ data: shares });
  });

  return r;
}
