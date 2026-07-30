import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ClientMeta } from '@connected-care/shared';
import { api } from '../api/client';

/**
 * The client contract from GET /v1/meta: metric catalog, tier language, score
 * bands, thresholds. Fetched once at boot (public endpoint) so every screen
 * renders the same experience any other presentation layer would get from the
 * same API — nothing experience-defining is compiled into this app.
 */

const Ctx = createContext<ClientMeta | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<ClientMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getMeta()
      .then(setMeta)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="p-10 text-center text-sm text-tier-urgent">Couldn't load the app contract: {error}</p>;
  if (!meta) return <p className="p-10 text-center text-sm text-gray-400">Loading…</p>;
  return <Ctx.Provider value={meta}>{children}</Ctx.Provider>;
}

export function useMeta(): ClientMeta {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMeta must be used within MetaProvider');
  return ctx;
}
