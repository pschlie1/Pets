import { useEffect, useState } from 'react';
import { api, type DeviceStatus } from '../api/client';
import { useHousehold } from '../state/HouseholdContext';
import { InsightCard } from '../components/InsightCard';

const ICONS: Record<string, string> = { containment_collar: '📡', feeder: '🍽️', fountain: '⛲' };

export function Equipment() {
  const { household, insights } = useHousehold();
  const [statuses, setStatuses] = useState<DeviceStatus[]>([]);

  useEffect(() => {
    if (!household) return;
    void Promise.all(household.devices.map((d) => api.getDeviceStatus(d.id))).then(setStatuses);
  }, [household, insights.length]);

  const equipmentInsights = insights.filter((i) => i.insight_type === 'equipment');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold">Equipment health</h1>
      <p className="-mt-4 text-sm text-gray-500">
        The same insight engine watches your gear — a failing device gets flagged before it becomes a gap for your pets.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {statuses.map((d) => {
          const battery = d.last_health_ping?.battery_pct as number | undefined;
          return (
            <div
              key={d.id}
              className={`rounded-2xl bg-card p-5 shadow-sm ${d.status !== 'active' ? 'ring-2 ring-amber-300' : ''}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden>
                  {ICONS[d.device_type] ?? '🔌'}
                </span>
                <div>
                  <h3 className="font-extrabold">{d.model ?? d.device_type}</h3>
                  <p className="text-xs capitalize text-gray-500">
                    {d.device_type.replace(/_/g, ' ')} · {d.assignment_mode}
                  </p>
                </div>
                <span
                  className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    d.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-tier-attention'
                  }`}
                >
                  {d.status === 'active' ? '● Online' : `● ${d.status.replace(/_/g, ' ')}`}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                {battery !== undefined && (
                  <div className="rounded-xl bg-cream p-2.5">
                    <dt className="text-xs text-gray-500">Battery</dt>
                    <dd className={`font-extrabold ${battery <= 20 ? 'text-tier-urgent' : ''}`}>{battery}%</dd>
                  </div>
                )}
                <div className="rounded-xl bg-cream p-2.5">
                  <dt className="text-xs text-gray-500">Last seen</dt>
                  <dd className="font-extrabold">
                    {d.last_seen ? new Date(d.last_seen).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">Equipment insights</h2>
        {equipmentInsights.length === 0 ? (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-gray-400 shadow-sm">
            All devices humming along. ✨
          </p>
        ) : (
          <div className="space-y-3">
            {equipmentInsights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
