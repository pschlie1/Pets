import { useEffect, useState } from 'react';
import type { EcosystemLine } from '@connected-care/shared';
import { api } from '../api/client';
import { useHousehold } from '../state/HouseholdContext';

/**
 * The connected-assortment vision: what's live in this household today and
 * the breadth that joins it next — every line plugging into the same
 * telemetry envelope and insight engine.
 */
export function Ecosystem() {
  const { household } = useHousehold();
  const [lines, setLines] = useState<EcosystemLine[]>([]);

  useEffect(() => {
    void api.getEcosystem().then(setLines).catch(() => setLines([]));
  }, []);

  const ownedTypes = new Set((household?.devices ?? []).map((d) => d.device_type));
  const categories = [...new Set(lines.map((l) => l.category))];

  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-navy p-5 text-white shadow-md">
        <h1 className="text-2xl font-extrabold text-brand">The connected ecosystem</h1>
        <p className="mt-1 text-sm opacity-80">
          One platform, one telemetry contract, one insight engine — every product line below plugs in with zero new
          endpoints. Safety, health, access, feeding, and comfort, for every pet in the household.
        </p>
      </header>

      {categories.map((category) => (
        <section key={category}>
          <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">{category}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {lines
              .filter((l) => l.category === category)
              .map((line) => {
                const inHome = line.device_type !== null && ownedTypes.has(line.device_type);
                return (
                  <div
                    key={line.name}
                    className={`rounded-2xl bg-card p-4 shadow-sm ${inHome ? 'ring-2 ring-safe/30' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl" aria-hidden>
                        {line.icon}
                      </span>
                      <h3 className="font-extrabold">{line.name}</h3>
                      <span
                        className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          inHome
                            ? 'bg-safe-soft text-safe'
                            : line.status === 'live'
                              ? 'bg-tier-monitor-soft text-tier-monitor'
                              : 'bg-cream text-gray-400'
                        }`}
                      >
                        {inHome ? '✓ In your home' : line.status === 'live' ? 'Available' : 'Coming soon'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-gray-600">{line.tagline}</p>
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
