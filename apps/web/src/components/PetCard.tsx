import { Link } from 'react-router-dom';
import type { Insight, Urgency } from '@connected-care/shared';
import { urgencyRank } from '@connected-care/shared';
import type { PetSummary } from '../api/client';
import { PetAvatar } from './PetAvatar';
import { UrgencyBadge } from './UrgencyBadge';

const RING: Record<Urgency, string> = {
  info: 'ring-safe/40',
  monitor: 'ring-tier-monitor/35',
  attention: 'ring-tier-attention/50',
  urgent: 'ring-tier-urgent/70',
  emergency: 'ring-tier-emergency/80',
};

function worstActive(insights: Insight[]): Urgency | null {
  const active = insights.filter(
    (i) => i.acknowledged_status !== 'dismissed' && i.acknowledged_status !== 'acknowledged' && i.urgency !== 'info',
  );
  if (active.length === 0) return null;
  return active.reduce((worst, i) => (urgencyRank(i.urgency) > urgencyRank(worst) ? i.urgency : worst), 'info' as Urgency);
}

export function PetCard({ pet, insights }: { pet: PetSummary; insights: Insight[] }) {
  const petInsights = insights.filter((i) => i.pet_id === pet.id);
  const worst = worstActive(petInsights);
  const age = pet.date_of_birth
    ? Math.floor((Date.now() - Date.parse(pet.date_of_birth)) / (365.25 * 86_400_000))
    : null;

  return (
    <Link
      to={`/pets/${pet.id}`}
      className={`block rounded-2xl bg-card p-5 shadow-sm ring-4 transition hover:shadow-md ${worst ? RING[worst] : 'ring-safe/25'}`}
    >
      <div className="flex items-center gap-4">
        <PetAvatar petId={pet.id} species={pet.species} hasPhoto={pet.has_photo} size="md" />
        <div>
          <h3 className="text-xl font-extrabold">{pet.name}</h3>
          <p className="text-sm text-gray-500">
            {age !== null ? `${age} yrs` : ''} {pet.weight_lbs ? `· ${pet.weight_lbs} lbs` : ''}
          </p>
        </div>
        <div className="ml-auto text-right">
          {worst ? (
            <UrgencyBadge urgency={worst} />
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-safe-soft px-2.5 py-0.5 text-xs font-bold text-safe">
              💚 All good
            </span>
          )}
          <p className="mt-1 text-xs text-gray-400">
            {petInsights.length > 0 ? `${petInsights.length} insight${petInsights.length > 1 ? 's' : ''}` : 'No insights yet'}
          </p>
        </div>
      </div>
    </Link>
  );
}
