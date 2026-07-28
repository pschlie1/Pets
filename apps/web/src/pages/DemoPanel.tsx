import { useEffect, useState } from 'react';
import type { ScenarioMeta } from '@connected-care/shared';
import { api } from '../api/client';
import { useHousehold } from '../state/HouseholdContext';
import { UrgencyBadge } from '../components/UrgencyBadge';

interface LogEntry {
  at: string;
  text: string;
  urgency?: ScenarioMeta['expectedUrgency'];
}

export function DemoPanel() {
  const { refresh } = useHousehold();
  const [scenarios, setScenarios] = useState<ScenarioMeta[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.getScenarios().then(setScenarios);
  }, []);

  const addLog = (text: string, urgency?: ScenarioMeta['expectedUrgency']) =>
    setLog((l) => [{ at: new Date().toLocaleTimeString(), text, urgency }, ...l].slice(0, 30));

  const run = async (fn: () => Promise<void>, key: string) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      addLog(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const trigger = (s: ScenarioMeta) =>
    run(async () => {
      const result = await api.triggerScenario(s.key);
      if (result.insights.length === 0) {
        addLog(`${s.name}: ${result.note ?? 'no new insight'}`);
      } else {
        for (const i of result.insights) addLog(i.summary, i.urgency);
      }
      await refresh();
    }, s.key);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-charcoal p-5 text-white shadow-md">
        <h1 className="text-2xl font-extrabold text-brand">🧪 Demo control panel</h1>
        <p className="mt-1 text-sm opacity-80">
          Every trigger writes real telemetry through the same pipeline production devices use — the insights you'll see
          are computed and narrated live, not scripted. Reset restores the pristine seeded household.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            onClick={() =>
              void run(async () => {
                await api.resetDemo();
                addLog('Household reset to pristine seed state 🌱');
                await refresh();
              }, 'reset')
            }
            disabled={busy !== null}
            className="rounded-full bg-brand px-5 py-2 font-extrabold text-charcoal hover:bg-brand-dark disabled:opacity-40"
          >
            {busy === 'reset' ? 'Resetting…' : '↺ Reset demo household'}
          </button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {scenarios.map((s) => (
          <div key={s.key} className="flex flex-col rounded-2xl bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <UrgencyBadge urgency={s.expectedUrgency} />
              <span className="text-xs capitalize text-gray-400">{s.insightType.replace('_', ' ')}</span>
            </div>
            <h3 className="mt-2 font-extrabold">{s.name}</h3>
            <p className="mt-1 text-sm text-gray-600">{s.description}</p>
            <p className="mt-2 rounded-xl bg-cream p-2.5 text-xs text-gray-600">
              <span className="font-bold">Watch for:</span> {s.watchFor}
            </p>
            <button
              onClick={() => void trigger(s)}
              disabled={busy !== null}
              className="mt-3 self-start rounded-full bg-charcoal px-4 py-2 text-sm font-extrabold text-white hover:opacity-85 disabled:opacity-40"
            >
              {busy === s.key ? 'Injecting telemetry…' : '▶ Trigger scenario'}
            </button>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-gray-400">Live event log</h2>
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl bg-card p-4 font-mono text-xs shadow-sm">
          {log.length === 0 && <p className="text-gray-400">Trigger a scenario to see the pipeline at work…</p>}
          {log.map((entry, i) => (
            <p key={i} className="flex items-start gap-2">
              <span className="shrink-0 text-gray-400">{entry.at}</span>
              {entry.urgency && <UrgencyBadge urgency={entry.urgency} />}
              <span>{entry.text}</span>
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
