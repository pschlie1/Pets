import type { NextFunction, Request, Response } from 'express';

/**
 * Bearer auth stub: any non-empty token is accepted; the demo token is
 * documented in the README as "demo-token".
 *
 * PRODUCTION NOTE: production validates a real JWT and derives the tenant
 * (household_id) claim used for row-level isolation.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ') || header.slice(7).trim() === '') {
    res.status(401).json({ error: { code: 'unauthorized', message: 'A bearer token is required.' } });
    return;
  }
  next();
}
