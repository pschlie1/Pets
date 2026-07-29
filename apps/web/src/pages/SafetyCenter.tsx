import { useEffect, useRef, useState } from 'react';
import {
  SIGNAL_STALE_MIN,
  type ContainmentPetStatus,
  type DayHistoryResponse,
  type DealerStatus,
  type DispatchStep,
  type HeatmapResponse,
} from '@connected-care/shared';
import { api } from '../api/client';
import { useHousehold } from '../state/HouseholdContext';
import { YardBase } from '../components/YardBase';
import { PetMarkers, YardMap } from '../components/YardMap';
import { YardHeatLayer } from '../components/YardHeatLayer';
import { YardPathLayer } from '../components/YardPathLayer';
import { InsightCard } from '../components/InsightCard';

const STATE_BADGE: Record<ContainmentPetStatus['containment_state'], { text: string; cls: string; icon: string }> = {
  protected: { text: 'Protected', cls: 'bg-safe-soft text-safe', icon: '🛡️' },
  breach: { text: 'Outside safe zone', cls: 'bg-tier-emergency-soft text-tier-emergency', icon: '⛔' },
  signal_lost: { text: 'Signal lost', cls: 'bg-tier-attention-soft text-tier-attention', icon: '📡' },
};

function SignalBars({ strength }: { strength: number | null }) {
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={`signal ${strength ?? 0} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1 rounded-sm ${i <= (strength ?? 0) ? 'bg-navy' : 'bg-gray-200'}`}
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
          ? 'ring-2 ring-tier-emergency/40'
          : pet.containment_state === 'signal_lost'
            ? 'ring-2 ring-tier-attention/50'
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

/* ----------------------------- map card views ----------------------------- */

type MapView = 'live' | 'heat' | 'day';

const chip = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-extrabold transition ${
    active ? 'bg-navy text-white' : 'bg-cream hover:bg-black/5'
  }`;

const HEAT_PERIODS = [
  { days: 1, label: '24 h' },
  { days: 7, label: '7 days' },
  { days: 21, label: '21 days' },
];

/** Plain-language read of where the busiest cell sits within the yard. */
function favoriteSpot(grid: HeatmapResponse, petId: string): string | null {
  const pet = grid.pets.find((p) => p.pet_id === petId);
  if (!pet || !grid.bbox || pet.total_points === 0 || pet.max_cell_count === 0) return null;
  const top = pet.cells.reduce((a, b) => (b.count > a.count ? b : a));
  const ns = top.r < grid.rows / 3 ? 'north' : top.r >= (2 * grid.rows) / 3 ? 'south' : '';
  const ew = top.c < grid.cols / 3 ? 'west' : top.c >= (2 * grid.cols) / 3 ? 'east' : '';
  const where = ns || ew ? `the ${ns}${ew} part of the yard` : 'the middle of the yard';
  const share = Math.round((top.count / pet.total_points) * 100);
  return `${pet.name}'s favorite spot is ${where} — ${share}% of check-ins land there. Brighter = more time spent.`;
}

function HeatView({ boundary, pets }: { boundary: ContainmentStatusBoundary; pets: ContainmentPetStatus[] }) {
  const [days, setDays] = useState(7);
  const [petId, setPetId] = useState(pets[0]?.pet_id ?? '');
  const [grid, setGrid] = useState<HeatmapResponse | null>(null);

  useEffect(() => {
    setGrid(null);
    void api.getContainmentHeatmap(days).then(setGrid).catch(() => setGrid(null));
  }, [days]);

  const petGrid = grid?.pets.find((p) => p.pet_id === petId) ?? null;
  const note = grid && petId ? favoriteSpot(grid, petId) : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {pets.map((p) => (
          <button key={p.pet_id} onClick={() => setPetId(p.pet_id)} className={chip(petId === p.pet_id)}>
            🐶 {p.name}
          </button>
        ))}
        <span className="ml-auto flex gap-1.5">
          {HEAT_PERIODS.map((p) => (
            <button key={p.days} onClick={() => setDays(p.days)} className={chip(days === p.days)}>
              {p.label}
            </button>
          ))}
        </span>
      </div>
      <YardBase boundary={boundary} ariaLabel={`Where ${petGrid?.name ?? 'your dog'} spends time`}>
        {(project) => (
          <>
            {grid && petGrid && <YardHeatLayer grid={grid} pet={petGrid} project={project} />}
            <PetMarkers pets={pets.filter((p) => p.pet_id === petId)} project={project} />
          </>
        )}
      </YardBase>
      <p className="mt-2 text-center text-xs text-gray-400">
        {grid === null ? 'Reading the movement record…' : note ?? 'No movement recorded in this period yet.'}
      </p>
    </div>
  );
}

type ContainmentStatusBoundary = Parameters<typeof YardBase>[0]['boundary'];

const hourLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function DayView({ boundary, pets }: { boundary: ContainmentStatusBoundary; pets: ContainmentPetStatus[] }) {
  const [history, setHistory] = useState<DayHistoryResponse | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [petId, setPetId] = useState(pets[0]?.pet_id ?? '');
  const [upTo, setUpTo] = useState(1);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // First load discovers available dates (today by default), then date changes refetch.
  useEffect(() => {
    const target = date ?? new Date().toISOString().slice(0, 10);
    setHistory(null);
    api
      .getContainmentHistory(target)
      .then((h) => {
        setHistory(h);
        // First load asked with the browser's UTC date; snap to the household-local today.
        if (!date) setDate(h.available_dates[0] ?? h.date);
      })
      .catch(() => setHistory(null));
  }, [date]);

  // Play: sweep the scrubber across the day in ~8 s.
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setUpTo((v) => {
        if (v >= 1) {
          setPlaying(false);
          return 1;
        }
        return Math.min(1, v + 0.02);
      });
    }, 160);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  const pet = history?.pets.find((p) => p.pet_id === petId) ?? null;
  const shownIdx = pet && pet.points.length > 0 ? Math.max(0, Math.round(pet.points.length * upTo) - 1) : 0;
  const dayLabel = (d: string, idx: number) =>
    idx === 0 && d === history?.available_dates[0]
      ? 'Today'
      : idx === 1
        ? 'Yesterday'
        : new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {pets.map((p) => (
          <button
            key={p.pet_id}
            onClick={() => {
              setPetId(p.pet_id);
              setUpTo(1);
              setPlaying(false);
            }}
            className={chip(petId === p.pet_id)}
          >
            🐶 {p.name}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {(history?.available_dates ?? []).map((d, idx) => (
          <button
            key={d}
            onClick={() => {
              setDate(d);
              setUpTo(1);
              setPlaying(false);
            }}
            className={`shrink-0 ${chip(d === history?.date)}`}
          >
            {dayLabel(d, idx)}
          </button>
        ))}
      </div>

      <YardBase
        boundary={boundary}
        extraPoints={pet?.events.flatMap((e) => (e.position ? [e.position] : [])) ?? []}
        ariaLabel={`${pet?.name ?? 'Dog'}'s movement on ${history?.date ?? 'this day'}`}
      >
        {(project) => (pet ? <YardPathLayer pet={pet} upTo={upTo} project={project} /> : <></>)}
      </YardBase>

      {history === null ? (
        <p className="mt-2 text-center text-xs text-gray-400">Fetching that day…</p>
      ) : !pet || pet.points.length === 0 ? (
        <p className="mt-2 text-center text-xs text-gray-400">No movement recorded that day.</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => {
                if (!playing && upTo >= 1) setUpTo(0);
                setPlaying(!playing);
              }}
              className="rounded-full bg-navy px-4 py-1.5 text-sm font-extrabold text-white hover:opacity-85"
            >
              {playing ? '⏸ Pause' : '▶ Replay day'}
            </button>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(upTo * 1000)}
              onChange={(e) => {
                setPlaying(false);
                setUpTo(Number(e.currentTarget.value) / 1000);
              }}
              className="w-full accent-navy"
              aria-label="Time of day"
            />
            <span className="w-20 shrink-0 text-right font-mono text-xs text-gray-500">
              {hourLabel(pet.points[shownIdx].t)}
            </span>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-cream p-2.5">
              <dt className="text-xs text-gray-500">Distance roamed</dt>
              <dd className="font-extrabold">
                {pet.stats.distance_m >= 1000
                  ? `${(pet.stats.distance_m / 1000).toFixed(1)} km`
                  : `${pet.stats.distance_m} m`}
              </dd>
            </div>
            <div className="rounded-xl bg-cream p-2.5">
              <dt className="text-xs text-gray-500">GPS check-ins</dt>
              <dd className="font-extrabold">{pet.stats.checks}</dd>
            </div>
            <div className="rounded-xl bg-cream p-2.5">
              <dt className="text-xs text-gray-500">Boundary events</dt>
              <dd className={`font-extrabold ${pet.stats.boundary_events > 0 ? 'text-tier-emergency' : 'text-safe'}`}>
                {pet.stats.boundary_events === 0 ? 'None 🎉' : pet.stats.boundary_events}
              </dd>
            </div>
            <div className="rounded-xl bg-cream p-2.5">
              <dt className="text-xs text-gray-500">Busiest hour</dt>
              <dd className="font-extrabold">
                {pet.stats.busiest_hour === null
                  ? '—'
                  : new Date(2026, 0, 1, pet.stats.busiest_hour).toLocaleTimeString([], { hour: 'numeric' })}
              </dd>
            </div>
          </dl>

          {pet.events.length > 0 && (
            <ol className="mt-3 space-y-1.5 rounded-xl bg-cream p-3">
              {pet.events.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span aria-hidden>{e.kind === 'breach' ? '⛔' : '↩️'}</span>
                  <span>
                    <span className="font-bold">{hourLabel(e.occurred_at)}</span> — {pet.name} {e.detail}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------- dealer card ------------------------------ */

const DISPATCH_STEPS: { key: DispatchStep; label: string }[] = [
  { key: 'alerted', label: 'Dealer alerted' },
  { key: 'reviewing', label: 'Associate reviewing' },
  { key: 'followed_up', label: 'Followed up by phone' },
];

/** The dealer-network moat, made visible: who serves this yard, and live
 * dispatch state whenever an emergency has been routed to the associate. */
function DealerCard({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<DealerStatus | null>(null);

  useEffect(() => {
    void api.getDealer().then(setStatus).catch(() => setStatus(null));
  }, [refreshKey]);

  if (!status?.dealer) return null;
  const stepIdx = status.dispatch ? DISPATCH_STEPS.findIndex((s) => s.key === status.dispatch!.step) : -1;

  return (
    <section className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-navy text-2xl" aria-hidden>
          🛠️
        </span>
        <div>
          <h2 className="font-extrabold">{status.dealer.name}</h2>
          <p className="text-xs text-gray-500">
            Your dealer · {status.dealer.associate} — knows your fence, your yard, and your dogs
          </p>
        </div>
        <a
          href={`tel:${status.dealer.phone.replace(/[^+\d]/g, '')}`}
          className="ml-auto rounded-full bg-navy px-4 py-2 text-sm font-extrabold text-white hover:opacity-85"
        >
          📞 {status.dealer.phone}
        </a>
      </div>
      {status.dispatch && (
        <div className="mt-4 rounded-xl bg-tier-emergency-soft p-3">
          <p className="text-xs font-bold text-tier-emergency">🚚 {status.dispatch.summary}</p>
          <ol className="mt-2 flex flex-wrap items-center gap-2">
            {DISPATCH_STEPS.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2 text-xs font-bold">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
                    i <= stepIdx ? 'bg-navy text-white' : 'bg-card text-gray-400'
                  }`}
                >
                  {i < stepIdx ? '✓' : i === stepIdx ? '●' : '○'} {s.label}
                </span>
                {i < DISPATCH_STEPS.length - 1 && <span className="text-gray-300">→</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/* --------------------------------- page ---------------------------------- */

export function SafetyCenter() {
  const { containment, insights, refreshContainment } = useHousehold();
  const [view, setView] = useState<MapView>('live');

  // Keep positions wandering while the page is open — the API's lazy top-up
  // synthesizes fresh collar check-ins on each poll.
  useEffect(() => {
    const t = setInterval(() => void refreshContainment(), 25_000);
    return () => clearInterval(t);
  }, [refreshContainment]);

  if (!containment) return <p className="p-8 text-gray-400">Checking the fence…</p>;

  const hasYard = containment.boundary.polygon.length > 0 && containment.pets.length > 0;

  const safetyInsights = insights.filter(
    (i) =>
      i.insight_type === 'pet_safety' ||
      (i.insight_type === 'equipment' && (i.metric === 'collar_battery_pct' || i.metric === 'containment_signal')),
  );

  const VIEWS: { key: MapView; label: string }[] = [
    { key: 'live', label: '📍 Live' },
    { key: 'heat', label: '🔥 Heat map' },
    { key: 'day', label: '📅 Day review' },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold">Safety Center</h1>
        <p className="text-sm text-gray-500">
          {containment.boundary.label} — live from each collar's GPS check-ins.
        </p>
      </header>

      <section className="rounded-2xl bg-card p-4 shadow-sm">
        {hasYard ? (
          <>
            <div className="mb-3 flex gap-1 rounded-full bg-cream p-1">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  className={`flex-1 whitespace-nowrap rounded-full px-2 py-1.5 text-xs font-extrabold transition sm:text-sm ${
                    view === v.key ? 'bg-navy text-white shadow-sm' : 'text-gray-500 hover:bg-black/5'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {view === 'live' && (
              <>
                <YardMap boundary={containment.boundary} pets={containment.pets} />
                <p className="mt-2 text-center text-xs text-gray-400">
                  Dashed yellow line = your invisible fence · positions update as collars check in
                </p>
              </>
            )}
            {view === 'heat' && <HeatView boundary={containment.boundary} pets={containment.pets} />}
            {view === 'day' && <DayView boundary={containment.boundary} pets={containment.pets} />}
          </>
        ) : (
          <p className="p-6 text-center text-sm text-gray-400">
            No containment system set up for this household yet — add a Boundary Plus collar to see the live yard map,
            heat map, and day-by-day movement history.
          </p>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {containment.pets.map((pet) => (
          <ContainmentCard key={pet.pet_id} pet={pet} />
        ))}
      </section>

      <DealerCard refreshKey={insights.length} />

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
