import { Link } from 'react-router-dom';
import { urgencyRank, type Urgency } from '@connected-care/shared';
import { useHousehold } from '../state/HouseholdContext';
import { InsightCard } from '../components/InsightCard';
import { PetCard } from '../components/PetCard';

const BANNER: Partial<Record<Urgency, { bg: string; msg: string }>> = {
  urgent: { bg: 'bg-tier-urgent', msg: 'Something needs your attention soon' },
  emergency: { bg: 'bg-tier-emergency', msg: 'Emergency — act now' },
};

export function Dashboard() {
  const { household, insights } = useHousehold();
  if (!household) return <p className="p-8 text-gray-400">Fetching the household…</p>;

  const active = insights.filter((i) => i.acknowledged_status === 'unseen' || i.acknowledged_status === 'seen');
  const worst = active.reduce<Urgency>((w, i) => (urgencyRank(i.urgency) > urgencyRank(w) ? i.urgency : w), 'info');
  const banner = BANNER[worst];
  const latest = active.slice(0, 3);
  const petName = (id: string | null) => household.pets.find((p) => p.id === id)?.name;

  return (
    <div className="space-y-6">
      {banner ? (
        <Link to="/insights" className={`block rounded-2xl p-4 text-white shadow-md ${banner.bg}`}>
          <p className="text-lg font-extrabold">🚨 {banner.msg}</p>
          <p className="text-sm opacity-90">Tap to see what we found and what to do about it.</p>
        </Link>
      ) : (
        <div className="rounded-2xl bg-card p-4 shadow-sm ring-2 ring-emerald-100">
          <p className="text-lg font-extrabold">💚 The whole crew is doing great</p>
          <p className="text-sm text-gray-500">
            We're watching heart rate, walks, meals, water, and the yard boundary — and we'll speak up first.
          </p>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">Your pets</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {household.pets.map((pet) => (
            <PetCard key={pet.id} pet={pet} insights={insights} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Latest insights</h2>
          <Link to="/insights" className="text-sm font-bold text-tier-monitor hover:underline">
            See all →
          </Link>
        </div>
        {latest.length === 0 ? (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-gray-400 shadow-sm">
            Nothing to report — try the <Link to="/demo" className="font-bold text-tier-monitor hover:underline">demo controls</Link> to
            see the insight engine in action. 🐾
          </p>
        ) : (
          <div className="space-y-3">
            {latest.map((i) => (
              <InsightCard key={i.id} insight={i} petName={petName(i.pet_id)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">Equipment</h2>
        <Link to="/equipment" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {household.devices.map((d) => (
            <span
              key={d.id}
              className={`rounded-2xl bg-card p-4 text-sm shadow-sm transition hover:shadow-md ${
                d.status !== 'active' ? 'ring-2 ring-amber-300' : ''
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {d.device_type === 'containment_collar' ? '📡' : d.device_type === 'feeder' ? '🍽️' : '⛲'}
              </span>
              <span className="mt-1 block font-bold">{d.model ?? d.device_type}</span>
              <span className={`text-xs ${d.status === 'active' ? 'text-emerald-600' : 'text-tier-attention'}`}>
                {d.status === 'active' ? '● Online' : `● ${d.status.replace('_', ' ')}`}
              </span>
            </span>
          ))}
        </Link>
      </section>
    </div>
  );
}
