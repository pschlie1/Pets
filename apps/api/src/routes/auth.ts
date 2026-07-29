import { Router } from 'express';
import { loginSchema, type Owner } from '@connected-care/shared';
import { signToken, verifyToken } from '../auth/tokens';
import type { Db } from '../db/connection';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

/**
 * Demo authentication: exchanges a known demo identity for a signed session
 * token carrying the household (tenant) claim.
 * PRODUCTION NOTE: this route is what a real IdP replaces — everything
 * downstream (claims, enforcement) is production-shaped.
 */
export function authRoutes(db: Db): Router {
  const r = Router();

  r.post('/auth/login', validate(loginSchema), (req, res) => {
    const owner = db
      .prepare(`SELECT id, email, display_name, household_id FROM owners WHERE email = ?`)
      .get(req.body.email.toLowerCase()) as Owner | undefined;
    if (!owner) {
      throw new ApiError(401, 'unknown_owner', 'No account exists for that email in this demo environment.');
    }
    const token = signToken({
      sub: owner.id,
      email: owner.email,
      name: owner.display_name,
      household_id: owner.household_id,
    });
    res.status(201).json({ data: { token, owner } });
  });

  r.get('/auth/me', (req, res) => {
    const header = req.headers.authorization ?? '';
    const claims = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
    if (!claims) throw new ApiError(401, 'unauthorized', 'A valid bearer token is required.');
    const owner = db
      .prepare(`SELECT id, email, display_name, household_id FROM owners WHERE id = ?`)
      .get(claims.sub) as Owner | undefined;
    if (!owner) throw new ApiError(401, 'unauthorized', 'The token does not match a known account.');
    res.json({ data: owner });
  });

  return r;
}
