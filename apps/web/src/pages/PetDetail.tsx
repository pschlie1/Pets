import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type MetricSeries, type PetDetailData } from '../api/client';
import { InsightCard } from '../components/InsightCard';
import { Sparkline } from '../components/Sparkline';
import { useHousehold } from '../state/HouseholdContext';

const TREND_METRICS = [
  { metric: 'resting_heart_rate', label: 'Resting heart rate', unit: 'bpm' },
  { metric: 'water_intake_ml', label: 'Water intake', unit: 'ml/day' },
  { metric: 'walk_minutes', label: 'Walk time', unit: 'min/day' },
] as const;

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
        <Link
          to={`/pets/${pet.id}/chat`}
          className="ml-auto rounded-full bg-brand px-5 py-2.5 font-extrabold text-charcoal shadow-sm hover:bg-brand-dark"
        >
          💬 Ask about {pet.name}
        </Link>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-extrabold uppercase tracking-wider text-gray-400">
          14-day trends <span className="normal-case font-semibold">(yellow band = {pet.name}'s own normal range)</span>
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {TREND_METRICS.map((t) => {
            const s = series[t.metric];
            const latest = s?.points[s.points.length - 1];
            return (
              <div key={t.metric} className="rounded-2xl bg-card p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{t.label}</p>
                <p className="text-2xl font-extrabold">
                  {latest ? latest.value : '—'} <span className="text-sm font-semibold text-gray-400">{t.unit}</span>
                </p>
                {s && <Sparkline points={s.points} baseline={s.baseline} />}
                {s?.baseline && (
                  <p className="mt-1 text-xs text-gray-400">
                    baseline {Math.round(s.baseline.mean)} {t.unit}
                    {s.baseline.status === 'insufficient_data' && ' · still learning'}
                  </p>
                )}
              </div>
            );
          })}
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
