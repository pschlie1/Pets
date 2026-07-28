import { Link } from 'react-router-dom';
import { urgencyRank, type Urgency } from '@connected-care/shared';
import { useHousehold } from '../state/HouseholdContext';
import { ContainmentStrip } from '../components/ContainmentStrip';
import { InsightCard } from '../components/InsightCard';
import { PetCard } from '../components/PetCard';

const BANNER: Partial<Record<Urgency, { bg: string; msg: string }>> = {
  urgent: { bg: 'bg-tier-urgent', msg: 'Something needs your attention soon' },
  emergency: { bg: 'bg-tier-emergency', msg: 'Emergency — act now' },
};

export function Dashboard() {
  const { household, insights, containment } = useHousehold();
  if (!household) return <p className="p-8 text-gray-400">Fetching the household…</p>;

  const active = insights.filter((i) => i.acknowledged_status === 'unseen' || i.acknowledged_status === 'seen');
  // The containment strip owns the safety story — the health banner only
  // speaks for health and equipment, so one event never yells twice.
  const healthWorst = active
    .filter((i) => i.insight_type !== 'pet_safety')
    .reduce<Urgency>((w, i) => (urgencyRank(i.urgency) > urgencyRank(w) ? i.urgency : w), 'info');
  const banner = BANNER[healthWorst];
  const allCalm = !banner && containment?.overall === 'all_safe';
  const latest = active.slice(0, 3);
  const petName = (id: string | null) => household.pets.find((p) => p.id === id)?.name;

  return (
    <div className="space-y-6">
      {banner && (
        <Link to="/insights" className={`block rounded-2xl p-4 text-white shadow-md ${banner.bg}`}>
          <p className="text-lg font-extrabold">🚨 {banner.msg}</p>
          <p className="text-sm opacity-90">Tap to see what we found and what to do about it.</p>
        </Link>
      )}

      {allCalm ? (
        // One combined reassurance card instead of two green cards in a row.
        <Link to="/safety" className="block rounded-2xl bg-card p-4 shadow-sm ring-2 ring-safe/25 transition hover:shadow-md">
          <p className="text-lg font-extrabold">💚 The whole crew is doing great</p>
          <p className="text-sm text-gray-500">
            Everyone's healthy and inside the safe zone — heart rate, walks, meals, water, and the invisible fence are
            all being watched, and we'll speak up first. 🛡️
          </p>
        </Link>
      ) : (
        <ContainmentStrip />
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {household.devices.map((d) => (
            <Link
              to="/equipment"
              key={d.id}
              className={`rounded-2xl bg-card p-4 text-sm shadow-sm transition hover:shadow-md ${
                d.status !== 'active' ? 'ring-2 ring-tier-attention/50' : ''
              }`}
            >
              <span className="text-2xl" aria-hidden>
                {d.device_type === 'containment_collar' ? '📡' : d.device_type === 'feeder' ? '🍽️' : '⛲'}
              </span>
              <span className="mt-1 block font-bold">{d.model ?? d.device_type}</span>
              <span className={`text-xs ${d.status === 'active' ? 'text-safe' : 'text-tier-attention'}`}>
                {d.status === 'active' ? '● Online' : `● ${d.status.replace('_', ' ')}`}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
