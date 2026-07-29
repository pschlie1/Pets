import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Owner } from '@connected-care/shared';
import { api, setSession } from '../api/client';

/**
 * Demo session: on boot the app signs in as the last-used demo identity,
 * falling back to the first identity the API's demo-identities endpoint
 * lists — so even the bootstrap identity is API-fed, never hardcoded. The
 * household everything renders for comes from the authenticated owner's
 * claim.
 */

const EMAIL_KEY = 'cc-demo-email';

interface AuthState {
  owner: Owner | null;
  error: string | null;
  switchAccount: (email: string) => Promise<boolean>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<Owner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loginAs = useCallback(async (email: string) => {
    try {
      const { token, owner: nextOwner } = await api.login(email);
      setSession(token, nextOwner.household_id);
      localStorage.setItem(EMAIL_KEY, nextOwner.email);
      setError(null);
      setOwner(nextOwner);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const stored = localStorage.getItem(EMAIL_KEY);
      // A stale stored identity (e.g. after a reseed) falls through to the
      // API-listed default.
      if (stored && (await loginAs(stored))) return;
      try {
        const identities = await api.getDemoIdentities();
        if (identities[0]) await loginAs(identities[0].email);
        else setError('No demo identities are seeded.');
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [loginAs]);

  return <Ctx.Provider value={{ owner, error, switchAccount: loginAs }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
