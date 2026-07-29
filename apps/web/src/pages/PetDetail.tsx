import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type MetricSeries, type PetDetailData } from '../api/client';
import { InsightCard } from '../components/InsightCard';
import { TrendCard } from '../components/TrendCard';
import { TREND_METRICS } from '../metrics';
import { useHousehold } from '../state/HouseholdContext';

export function PetDetail() {
  const { petId } = useParams<{ petId: string }>();
  const { insights } = useHousehold();
  const [pet, setPet] = useState<PetDetailData | null>(null);
  const [series, setSeries] = useState<Record<string, MetricSeries>>({});

  useEffect(() => {
    if (!petId) return;
    void api.getPet(petId).then(setPet);
    for (const t of TREND_METRICS) {
      void api.getPetMetrics(petId, t.metric).then((s) => setSeries((prev) => ({ ...prev, [t.metric]: s })));
    }
  }, [petId, insights.length]);

  if (!pet) return <p className="p-8 text-gray-400">Fetching…</p>;

  const petInsights = insights.filter((i) => i.pet_id === pet.id);
  const age = pet.date_of_birth
    ? Math.floor((Date.now() - Date.parse(pet.date_of_birth)) / (365.25 * 86_400_000))
    : null;

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-block text-sm font-bold text-gray-400 hover:text-charcoal">
        ← Home
      </Link>
      <header className="flex flex-wrap items-center gap-4 rounded-2xl bg-card p-5 shadow-sm">
        <div className="grid h-20 w-20 place-items-center rounded-full bg-brand text-4xl" aria-hidden>
          {pet.species === 'dog' ? '🐶' : pet.species === 'cat' ? '🐱' : '🐾'}
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">{pet.name}</h1>
          <p className="text-sm text-gray-500">
            {pet.breed_name ?? pet.species}
            {age !== null && ` · ${age} years`}
            {pet.weight_lbs && ` · ${pet.weight_lbs} lbs`}
          </p>
        </div>
        <span className="ml-auto flex flex-wrap gap-2">
          <Link
            to={`/pets/${pet.id}/vet-report`}
            className="rounded-full border border-black/10 bg-card px-4 py-2.5 text-sm font-extrabold hover:bg-cream"
          >
            📋 Vet report
          </Link>
          <Link
            to={`/pets/${pet.id}/chat`}
            className="rounded-full bg-brand px-5 py-2.5 font-extrabold text-brand-ink shadow-sm hover:bg-brand-dark"
          >
            💬 Ask about {pet.name}
          </Link>
        </span>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">
          14-day trends <span className="normal-case font-semibold">(yellow band = {pet.name}'s own normal range)</span>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {TREND_METRICS.map((t) => (
            <TrendCard key={t.metric} label={t.label} unit={t.unit} series={series[t.metric] ?? null} />
          ))}
        </div>
      </section>

      {pet.common_conditions.length > 0 && (
        <section className="rounded-2xl bg-card p-5 shadow-sm">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">
            What we watch for a {pet.breed_name ?? pet.species}
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {pet.common_conditions.map((c) => (
              <li key={c.condition} className="flex items-start gap-2 text-sm">
                <span aria-hidden>{c.monitorable_today ? '👁️' : '🔭'}</span>
                <span>
                  <span className="font-bold capitalize">{c.condition}</span>
                  <span className="block text-xs text-gray-500">
                    {c.typical_onset} · {c.monitorable_today ? 'monitored by your devices today' : 'future sensor territory'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">{pet.name}'s insights</h2>
        {petInsights.length === 0 ? (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-gray-400 shadow-sm">All quiet. 🐾</p>
        ) : (
          <div className="space-y-3">
            {petInsights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
