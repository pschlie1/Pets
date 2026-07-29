import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Dependency-free HS256 JWT: sign and verify the demo session token carrying
 * the tenant (household) claim.
 *
 * PRODUCTION NOTE: a real deployment replaces the login route with an IdP and
 * verifies its tokens here (issuer/audience/keys) — the claim contract and the
 * downstream tenant enforcement stay exactly as they are.
 */

export interface AuthClaims {
  sub: string; // owner id
  email: string;
  name: string;
  household_id: string;
  exp: number; // unix seconds
}

const DEFAULT_SECRET = 'connected-care-demo-secret';
let warned = false;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && !warned) {
    warned = true;
    console.warn('AUTH_SECRET not set — using the built-in demo secret (fine for demos, never for production).');
  }
  return s ?? DEFAULT_SECRET;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');
const HEADER = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

function hmac(input: string): Buffer {
  return createHmac('sha256', secret()).update(input).digest();
}

export const TOKEN_TTL_SECONDS = 12 * 60 * 60;

export function signToken(claims: Omit<AuthClaims, 'exp'>, ttlSeconds: number = TOKEN_TTL_SECONDS): string {
  const payload: AuthClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = `${HEADER}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  return `${body}.${b64url(hmac(body))}`;
}

/** Returns the claims for a valid, unexpired token; null otherwise. */
export function verifyToken(token: string): AuthClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    const expected = hmac(`${header}.${payload}`);
    const got = Buffer.from(signature, 'base64url');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as AuthClaims;
    if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null;
    if (!claims.sub || !claims.household_id) return null;
    return claims;
  } catch {
    return null;
  }
}
