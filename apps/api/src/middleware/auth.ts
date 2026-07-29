import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../auth/tokens';
import type { Db } from '../db/connection';
import { ApiError } from './errors';

/**
 * Bearer authentication with a real tenant claim: the token must be a valid
 * signed session token, and its household_id claim is what every tenant-scoped
 * endpoint enforces against.
 *
 * PRODUCTION NOTE: swap token verification for the IdP's; the claim contract
 * and enforcement below are production-shaped (service-layer row isolation —
 * the Postgres schema this demo was adapted from adds RLS on top).
 */

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { ownerId: string; householdId: string };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const claims = header.startsWith('Bearer ') ? verifyToken(header.slice(7).trim()) : null;
  if (!claims) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'A valid bearer token is required. Obtain one from POST /v1/auth/login.' } });
    return;
  }
  req.auth = { ownerId: claims.sub, householdId: claims.household_id };
  next();
}

/** Rejects any access to a household other than the caller's own. */
export function assertHousehold(req: Request, householdId: string): void {
  if (!req.auth || req.auth.householdId !== householdId) {
    throw new ApiError(403, 'forbidden', 'This resource belongs to a different household.');
  }
}

/** Resolves a pet's household (404 when absent) for tenancy checks. */
export function petHousehold(db: Db, petId: string): string {
  const row = db.prepare(`SELECT household_id FROM pets WHERE id = ? AND deleted_at IS NULL`).get(petId) as
    | { household_id: string }
    | undefined;
  if (!row) throw new ApiError(404, 'not_found', 'Pet not found.');
  return row.household_id;
}

/** Resolves a device's household (404 when absent) for tenancy checks. */
export function deviceHousehold(db: Db, deviceId: string): string {
  const row = db.prepare(`SELECT household_id FROM devices WHERE id = ? AND deleted_at IS NULL`).get(deviceId) as
    | { household_id: string }
    | undefined;
  if (!row) throw new ApiError(404, 'not_found', 'Device not found.');
  return row.household_id;
}
