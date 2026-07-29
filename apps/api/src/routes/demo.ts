import { Router } from 'express';
import { SCENARIO_LIST, SCENARIOS, type ScenarioKey } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { REF, resetAll, seedAll } from '../db/seed';
import { triggerScenario } from '../demo/scenarios';
import type { InsightListener } from '../engine/pipeline';
import { assertHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';

/**
 * Demo presentation tier endpoints (PRD §8): seed, reset, and live scenario
 * triggers. The seeded data flows through the same schema and the scenarios
 * run the same scoring pipeline as production ingestion — nothing scripted.
 */
export function demoRoutes(db: Db, onInsight: InsightListener): Router {
  const r = Router();

  r.post('/demo/households', (_req, res) => {
    const existing = db.prepare(`SELECT id FROM households WHERE id = ?`).get(REF.householdId);
    if (!existing) seedAll(db);
    res.status(201).json({ data: { household_id: REF.householdId, seeded: !existing } });
  });

  r.post('/demo/households/:id/reset', (req, res) => {
    if (req.params.id !== REF.householdId) {
      throw new ApiError(404, 'not_found', 'Only the reference demo household can be reset.');
    }
    // Scenario/reset controls belong to the reference household's owner only.
    assertHousehold(req, REF.householdId);
    resetAll(db);
    res.json({ data: { household_id: REF.householdId, reset: true } });
  });

  r.get('/demo/scenarios', (_req, res) => {
    res.json({ data: SCENARIO_LIST });
  });

  r.post('/demo/households/:id/scenarios/:key', async (req, res, next) => {
    try {
      if (req.params.id !== REF.householdId) {
        throw new ApiError(404, 'not_found', 'Scenarios run against the reference demo household.');
      }
      assertHousehold(req, REF.householdId);
      const key = req.params.key as ScenarioKey;
      if (!SCENARIOS[key]) {
        throw new ApiError(404, 'unknown_scenario', `Unknown scenario '${key}'.`, {
          available: Object.keys(SCENARIOS),
        });
      }
      const insights = await triggerScenario(db, key, Date.now(), onInsight);
      res.json({
        data: {
          scenario: SCENARIOS[key],
          insights,
          note:
            insights.length === 0
              ? 'No new insight produced — likely already triggered today. Reset the demo household to run it again.'
              : undefined,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
