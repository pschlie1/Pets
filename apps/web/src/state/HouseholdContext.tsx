import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContainmentStatus, Insight } from '@connected-care/shared';
import { api, HOUSEHOLD_ID, type HouseholdDetail } from '../api/client';

interface HouseholdState {
  household: HouseholdDetail | null;
  insights: Insight[];
  containment: ContainmentStatus | null;
  toast: Insight | null;
  clearToast: () => void;
  refresh: () => Promise<void>;
  refreshContainment: () => Promise<void>;
  updateInsight: (insight: Insight) => void;
}

const Ctx = createContext<HouseholdState | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [household, setHousehold] = useState<HouseholdDetail | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [containment, setContainment] = useState<ContainmentStatus | null>(null);
  const [toast, setToast] = useState<Insight | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refreshContainment = useCallback(async () => {
    try {
      setContainment(await api.getContainment());
    } catch {
      // API still booting or reseeding; the next refresh will pick it up.
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [hh, page] = await Promise.all([api.getHousehold(), api.getInsights({ limit: 100 })]);
      setHousehold(hh);
      setInsights(page.items);
      await refreshContainment();
    } catch {
      // API still booting or reseeding; the next refresh will pick it up.
    }
  }, [refreshContainment]);

  const updateInsight = useCallback((insight: Insight) => {
    setInsights((prev) => {
      const idx = prev.findIndex((i) => i.id === insight.id);
      if (idx === -1) return [insight, ...prev];
      const next = [...prev];
      next[idx] = insight;
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
    // Live insight push: SSE with native reconnect.
    const es = new EventSource(`/v1/households/${HOUSEHOLD_ID}/stream`);
    esRef.current = es;
    es.addEventListener('insight', (e) => {
      const insight = JSON.parse((e as MessageEvent).data) as Insight;
      updateInsight(insight);
      setToast(insight);
      // Every scenario emits an insight, so this keeps the yard map and
      // containment strip current without a manual refresh.
      void refreshContainment();
    });
    return () => es.close();
  }, [refresh, refreshContainment, updateInsight]);

  return (
    <Ctx.Provider
      value={{
        household,
        insights,
        containment,
        toast,
        clearToast: () => setToast(null),
        refresh,
        refreshContainment,
        updateInsight,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHousehold must be used within HouseholdProvider');
  return ctx;
}
