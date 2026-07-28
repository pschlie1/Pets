import { Link } from 'react-router-dom';
import { useHousehold } from '../state/HouseholdContext';

/**
 * Dashboard containment banner — the reassurance-first proof of the safety
 * value proposition. Green when everything is verified; escalates when a pet
 * is out, a collar goes quiet, or a battery threatens containment.
 */
export function ContainmentStrip() {
  const { containment } = useHousehold();
  if (!containment) return null;

  const breached = containment.pets.filter((p) => p.containment_state === 'breach');
  const silent = containment.pets.filter((p) => p.containment_state === 'signal_lost');
  const lowBattery = containment.pets.filter((p) => (p.battery_pct ?? 100) <= 20);

  let tone = 'ring-2 ring-emerald-200 bg-card';
  let icon = '🛡️';
  let title = `Containment active — ${containment.pets.map((p) => p.name).join(' & ')} ${
    containment.pets.length === 1 ? 'is' : 'are'
  } in the safe zone`;
  let sub = 'The invisible fence is verified and watching. We speak up the moment that changes.';

  if (breached.length > 0) {
    tone = 'bg-tier-emergency text-white shadow-md';
    icon = '⛔';
    title = `${breached.map((p) => p.name).join(' & ')} ${breached.length === 1 ? 'is' : 'are'} outside the safe zone`;
    sub = 'Open the Safety Center for the last known position.';
  } else if (silent.length > 0) {
    tone = 'ring-2 ring-amber-300 bg-amber-50';
    icon = '📡';
    title = `${silent.map((p) => p.name).join(' & ')}'s collar signal lost — containment unverified`;
    sub = 'No recent collar check-in. Check the collar and keep outdoor time supervised.';
  } else if (lowBattery.length > 0) {
    tone = 'ring-2 ring-amber-300 bg-amber-50';
    icon = '🔋';
    title = `Collar battery critical on ${lowBattery.map((p) => p.name).join(' & ')}'s collar`;
    sub = 'Below this level boundary corrections may not deliver — charge it today.';
  }

  return (
    <Link to="/safety" className={`block rounded-2xl p-4 transition hover:shadow-md ${tone}`}>
      <p className="text-lg font-extrabold">
        <span aria-hidden>{icon} </span>
        {title}
      </p>
      <p className="text-sm opacity-80">{sub}</p>
    </Link>
  );
}
