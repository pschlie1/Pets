import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { urgencyRank, type Urgency } from '@connected-care/shared';
import { api, type MetricSeries, type PetSummary } from '../api/client';
import { InsightCard } from '../components/InsightCard';
import { TrendCard } from '../components/TrendCard';
import { UrgencyBadge } from '../components/UrgencyBadge';
import { TREND_METRICS } from '../metrics';
import { useHousehold } from '../state/HouseholdContext';

function PetHealthSection({ pet, worst }: { pet: PetSummary; worst: Urgency | null }) {
  const [series, setSeries] = useState<Record<string, MetricSeries>>({});
  const { insights } = useHousehold();

  useEffect(() => {
    setSeries({});
    for (const t of TREND_METRICS) {
      void api.getPetMetrics(pet.id, t.metric).then((s) => setSeries((prev) => ({ ...prev, [t.metric]: s })));
    }
  }, [pet.id, insights.length]);

  return (
    <section className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-brand text-2xl" aria-hidden>
          {pet.species === 'dog' ? '🐶' : pet.species === 'cat' ? '🐱' : '🐾'}
        </span>
        <div>
          <h2 className="font-extrabold">{pet.name}</h2>
          <p className="text-xs text-gray-500">14-day trends vs {pet.name}'s own baseline</p>
        </div>
        <span className="ml-auto">
          {worst ? (
            <UrgencyBadge urgency={worst} />
          ) : (
            <span className="rounded-full bg-safe-soft px-2.5 py-1 text-xs font-bold text-safe">💚 On baseline</span>
          )}
        </span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {TREND_METRICS.map((t) => (
          <TrendCard key={t.metric} label={t.label} unit={t.unit} series={series[t.metric] ?? null} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          to={`/pets/${pet.id}`}
          className="rounded-full border border-black/10 bg-card px-4 py-2 text-sm font-extrabold hover:bg-cream"
        >
          Full profile
        </Link>
        <Link
          to={`/pets/${pet.id}/vet-report`}
          className="rounded-full border border-black/10 bg-card px-4 py-2 text-sm font-extrabold hover:bg-cream"
        >
          📋 Vet report
        </Link>
        <Link
          to={`/pets/${pet.id}/chat`}
          className="rounded-full bg-brand px-4 py-2 text-sm font-extrabold text-brand-ink hover:bg-brand-dark"
        >
          💬 Ask about {pet.name}
        </Link>
      </div>
    </section>
  );
}

export function HealthCenter() {
  const { household, insights } = useHousehold();
  if (!household) return <p className="p-8 text-gray-400">Checking on everyone…</p>;

  const healthInsights = insights.filter((i) => i.insight_type === 'pet_health');
  const active = healthInsights.filter(
    (i) => i.acknowledged_status === 'unseen' || i.acknowledged_status === 'seen',
  );
  // Worst active health urgency per pet drives the section badge.
  const worstFor = (petId: string): Urgency | null =>
    active
      .filter((i) => i.pet_id === petId)
      .reduce<Urgency | null>((w, i) => (w === null || urgencyRank(i.urgency) > urgencyRank(w) ? i.urgency : w), null);
  const petName = (id: string | null) => household.pets.find((p) => p.id === id)?.name;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Health Center</h1>
        <p className="text-sm text-gray-500">
          Every pet measured against their own baseline — heart rate, walks, meals, water, and sleep.
        </p>
      </header>

      {household.pets.map((pet) => (
        <PetHealthSection key={pet.id} pet={pet} worst={worstFor(pet.id)} />
      ))}

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">Health insights</h2>
        {healthInsights.length === 0 ? (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-gray-400 shadow-sm">
            Everyone's on their baseline. ✨
          </p>
        ) : (
          <div className="space-y-3">
            {healthInsights.map((i) => (
              <InsightCard key={i.id} insight={i} petName={petName(i.pet_id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
