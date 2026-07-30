import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  urgencyRank,
  type Briefing,
  type Milestone,
  type PeaceOfMindScore,
  type Urgency,
} from '@connected-care/shared';
import { api } from '../api/client';
import { useHousehold } from '../state/HouseholdContext';
import { ContainmentStrip } from '../components/ContainmentStrip';
import { InsightCard } from '../components/InsightCard';
import { PetCard } from '../components/PetCard';
import { ScoreRing } from '../components/ScoreRing';
import { useMeta } from '../state/MetaContext';

const GREETING: Record<Briefing['greeting_period'], string> = {
  morning: '☀️ Good morning',
  afternoon: '🌤️ Good afternoon',
  evening: '🌙 Good evening',
};

/** The engagement hero: narrated briefing + Peace-of-Mind score + wins. */
function Hero({ insightCount }: { insightCount: number }) {
  const { score_bands } = useMeta();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [score, setScore] = useState<PeaceOfMindScore | null>(null);
  const [wins, setWins] = useState<Milestone[]>([]);

  // Refetch whenever the insight set changes (scenario, ack, reset) so the
  // score and narration always match the screens below.
  useEffect(() => {
    void api.getBriefing().then(setBriefing).catch(() => setBriefing(null));
    void api.getScore().then(setScore).catch(() => setScore(null));
    void api.getMilestones().then(setWins).catch(() => setWins([]));
  }, [insightCount]);

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="rounded-2xl bg-card p-5 shadow-sm">
          <h2 className="font-extrabold">{briefing ? GREETING[briefing.greeting_period] : '☀️ Your briefing'}</h2>
          {briefing ? (
            <>
              <p className="mt-1 text-sm text-gray-600">{briefing.summary}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {briefing.facts.map((f, i) => (
                  <span key={i} className="rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-gray-600">
                    <span aria-hidden>{f.icon}</span> {f.text}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-gray-400">Putting together the overnight picture…</p>
          )}
        </div>
        <div className="flex items-center justify-center rounded-2xl bg-card p-4 shadow-sm sm:w-44 sm:flex-col">
          {score ? (
            <>
              <ScoreRing score={score.score} band={score.band} label={score_bands.find((b) => b.key === score.band)?.label ?? score.band} />
              <p className="ml-3 text-xs text-gray-500 sm:ml-0 sm:mt-1 sm:text-center">Peace-of-Mind score</p>
            </>
          ) : (
            <p className="text-sm text-gray-400">…</p>
          )}
        </div>
      </section>
      {score && score.factors.some((f) => f.delta !== 0) && (
        <section className="rounded-2xl bg-card px-5 py-3 text-xs text-gray-600 shadow-sm">
          {score.factors.map((f, i) => (
            <p key={i} className="py-0.5">
              <span className="font-bold text-tier-urgent">{f.delta}</span> · {f.label}
            </p>
          ))}
        </section>
      )}
      {wins.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-gray-400">🏆 Wins</h2>
          <div className="flex flex-wrap gap-2">
            {wins.map((w, i) => (
              <div key={i} className="rounded-2xl bg-card px-4 py-2.5 shadow-sm">
                <p className="text-sm font-extrabold">
                  <span aria-hidden>{w.icon}</span> {w.title}
                </p>
                <p className="text-xs text-gray-500">{w.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

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

      {!allCalm && <ContainmentStrip />}

      <Hero insightCount={insights.length} />

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Your pets</h2>
          <Link to="/health" className="text-sm font-bold text-action hover:underline">
            Health Center →
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {household.pets.map((pet) => (
            <PetCard key={pet.id} pet={pet} insights={insights} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">Latest insights</h2>
          <Link to="/insights" className="text-sm font-bold text-action hover:underline">
            See all →
          </Link>
        </div>
        {latest.length === 0 ? (
          <p className="rounded-2xl bg-card p-6 text-center text-sm text-gray-400 shadow-sm">
            Nothing to report — try the <Link to="/demo" className="font-bold text-action hover:underline">demo controls</Link> to
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
