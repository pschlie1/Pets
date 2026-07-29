import { useState } from 'react';
import { URGENCY_TIERS, urgencyRank, type Urgency } from '@connected-care/shared';
import { useHousehold } from '../state/HouseholdContext';
import { InsightCard } from '../components/InsightCard';
import { TierExplainer } from '../components/TierExplainer';
import { UrgencyBadge } from '../components/UrgencyBadge';

const PAGE_SIZE = 8;

export function Insights() {
  const { household, insights } = useHousehold();
  const [minTier, setMinTier] = useState<Urgency | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [page, setPage] = useState(1);

  const filtered = insights
    .filter((i) => (minTier ? urgencyRank(i.urgency) >= urgencyRank(minTier) : true))
    .filter((i) =>
      showResolved ? true : i.acknowledged_status !== 'dismissed' && i.acknowledged_status !== 'acknowledged',
    );
  const pages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const petName = (id: string | null) => household?.pets.find((p) => p.id === id)?.name;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Insights</h1>

      <TierExplainer />

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setMinTier(null);
            setPage(1);
          }}
          className={`rounded-full px-3 py-1 text-xs font-bold ${minTier === null ? 'bg-navy text-white' : 'bg-card shadow-sm hover:bg-cream'}`}
        >
          All tiers
        </button>
        {URGENCY_TIERS.map((tier) => (
          <button
            key={tier}
            onClick={() => {
              setMinTier(tier);
              setPage(1);
            }}
            className={`rounded-full ${minTier === tier ? 'ring-2 ring-charcoal' : ''}`}
            title={`Show ${tier} and above`}
          >
            <UrgencyBadge urgency={tier} />
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs font-bold text-gray-500">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl bg-card p-8 text-center text-sm text-gray-400 shadow-sm">
          Nothing here — that's a good thing. 🐾
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((i) => (
            <InsightCard key={i.id} insight={i} petName={petName(i.pet_id)} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm font-bold">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-full bg-card px-3 py-1 shadow-sm disabled:opacity-40">
            ← Prev
          </button>
          <span className="text-gray-400">
            {page} / {pages}
          </span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded-full bg-card px-3 py-1 shadow-sm disabled:opacity-40">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
