import { Router } from 'express';
import { agentQuerySchema } from '@connected-care/shared';
import { answerQuestion } from '../agents/companion';
import type { Db } from '../db/connection';
import { assertHousehold, petHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

export function agentRoutes(db: Db): Router {
  const r = Router();

  r.post('/agent/query', validate(agentQuerySchema), async (req, res, next) => {
    try {
      assertHousehold(req, petHousehold(db, req.body.pet_id));
      const reply = await answerQuestion(db, req.body.pet_id, req.body.question);
      if (!reply) throw new ApiError(404, 'not_found', 'Pet not found.');
      res.json({ data: reply });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
