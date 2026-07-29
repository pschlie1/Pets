import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Owner } from '@connected-care/shared';
import { api, setSession } from '../api/client';

/**
 * Demo session: on boot the app signs in as the last-used demo identity
 * (defaulting to the reference household's owner) so the demo stays
 * walk-up-ready. The household everything renders for comes from the
 * authenticated owner's claim — never hardcoded.
 */

const EMAIL_KEY = 'cc-demo-email';
const DEFAULT_EMAIL = 'peter@connectedcare.demo';

interface AuthState {
  owner: Owner | null;
  error: string | null;
  switchAccount: (email: string) => Promise<void>;
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
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const email = localStorage.getItem(EMAIL_KEY) ?? DEFAULT_EMAIL;
    void loginAs(email).then(() => {
      // A stale stored identity (e.g. after a reseed) falls back to the default.
      if (email !== DEFAULT_EMAIL) {
        setOwner((current) => {
          if (!current) void loginAs(DEFAULT_EMAIL);
          return current;
        });
      }
    });
  }, [loginAs]);

  return <Ctx.Provider value={{ owner, error, switchAccount: loginAs }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
