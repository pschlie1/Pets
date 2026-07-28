import { useEffect } from 'react';
import { SIGNAL_STALE_MIN, type ContainmentPetStatus } from '@connected-care/shared';
import { useHousehold } from '../state/HouseholdContext';
import { YardMap } from '../components/YardMap';
import { InsightCard } from '../components/InsightCard';

const STATE_BADGE: Record<ContainmentPetStatus['containment_state'], { text: string; cls: string; icon: string }> = {
  protected: { text: 'Protected', cls: 'bg-emerald-50 text-emerald-700', icon: '🛡️' },
  breach: { text: 'Outside safe zone', cls: 'bg-red-50 text-tier-emergency', icon: '⛔' },
  signal_lost: { text: 'Signal lost', cls: 'bg-amber-50 text-tier-attention', icon: '📡' },
};

function SignalBars({ strength }: { strength: number | null }) {
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={`signal ${strength ?? 0} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1 rounded-sm ${i <= (strength ?? 0) ? 'bg-charcoal' : 'bg-gray-200'}`}
          style={{ height: `${4 + i * 2}px` }}
        />
      ))}
    </span>
  );
}

function ContainmentCard({ pet }: { pet: ContainmentPetStatus }) {
  const badge = STATE_BADGE[pet.containment_state];
  const stale = (pet.minutes_since_check_in ?? 0) >= SIGNAL_STALE_MIN;
  const batteryLow = (pet.battery_pct ?? 100) <= 20;

  return (
    <div
      className={`rounded-2xl bg-card p-5 shadow-sm ${
        pet.containment_state === 'breach'
          ? 'ring-2 ring-red-300'
          : pet.containment_state === 'signal_lost'
            ? 'ring-2 ring-amber-300'
            : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand text-2xl" aria-hidden>
          🐶
        </span>
        <div>
          <h3 className="font-extrabold">{pet.name}</h3>
          <p className="text-xs text-gray-500">{pet.device_label}</p>
        </div>
        <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${badge.cls}`}>
          <span aria-hidden>{badge.icon}</span>
          {badge.text}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl bg-cream p-2.5">
          <dt className="text-xs text-gray-500">Last check-in</dt>
          <dd className={`font-extrabold ${stale ? 'text-tier-attention' : ''}`}>
            {pet.minutes_since_check_in !== null ? `${pet.minutes_since_check_in} min ago` : '—'}
          </dd>
        </div>
        <div className="rounded-xl bg-cream p-2.5">
          <dt className="text-xs text-gray-500">Battery</dt>
          <dd className={`font-extrabold ${batteryLow ? 'text-tier-urgent' : ''}`}>
            {pet.battery_pct !== null ? `${pet.battery_pct}%` : '—'}
          </dd>
        </div>
        <div className="rounded-xl bg-cream p-2.5">
          <dt className="text-xs text-gray-500">Signal</dt>
          <dd className="font-extrabold">
            {pet.containment_state === 'signal_lost' ? (
              <span className="text-tier-attention">lost</span>
            ) : (
              <SignalBars strength={pet.signal_strength} />
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

const TIMELINE_ICON: Record<string, string> = {
  breach: '⛔',
  return_to_zone: '↩️',
  signal_lost: '📡',
  check: '📍',
};

export function SafetyCenter() {
  const { containment, insights, refreshContainment } = useHousehold();

  // Keep positions wandering while the page is open — the API's lazy top-up
  // synthesizes fresh collar check-ins on each poll.
  useEffect(() => {
    const t = setInterval(() => void refreshContainment(), 25_000);
    return () => clearInterval(t);
  }, [refreshContainment]);

  if (!containment) return <p className="p-8 text-gray-400">Checking the fence…</p>;

  const safetyInsights = insights.filter(
    (i) =>
      i.insight_type === 'pet_safety' ||
      (i.insight_type === 'equipment' && (i.metric === 'collar_battery_pct' || i.metric === 'containment_signal')),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Safety Center</h1>
        <p className="text-sm text-gray-500">
          {containment.boundary.label} — live from each collar's GPS check-ins.
        </p>
      </header>

      <section className="rounded-2xl bg-card p-4 shadow-sm">
        <YardMap boundary={containment.boundary} pets={containment.pets} />
        <p className="mt-2 text-center text-xs text-gray-400">
          Dashed yellow line = your invisible fence · positions update as collars check in
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {containment.pets.map((pet) => (
          <ContainmentCard key={pet.pet_id} pet={pet} />
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">Boundary activity</h2>
        {containment.recent_events.length === 0 ? (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-gray-400 shadow-sm">
            No boundary events in the last 48 hours — exactly how we like it. 🐾
          </p>
        ) : (
          <ol className="space-y-2 rounded-2xl bg-card p-4 shadow-sm">
            {containment.recent_events.map((e, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm">
                <span aria-hidden>{TIMELINE_ICON[e.kind] ?? '•'}</span>
                <span>
                  <span className="font-bold">{e.pet_name ?? 'Household'}</span>{' '}
                  <span className="capitalize">{e.kind.replace(/_/g, ' ')}</span> — {e.detail}
                  <time className="block text-xs text-gray-400">{new Date(e.occurred_at).toLocaleString()}</time>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">Safety insights</h2>
        {safetyInsights.length === 0 ? (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-gray-400 shadow-sm">All clear. ✨</p>
        ) : (
          <div className="space-y-3">
            {safetyInsights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
