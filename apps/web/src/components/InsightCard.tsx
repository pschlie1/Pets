import { Link } from 'react-router-dom';
import type { Insight } from '@connected-care/shared';
import { api } from '../api/client';
import { useHousehold } from '../state/HouseholdContext';
import { UrgencyBadge } from './UrgencyBadge';

export function InsightCard({ insight, petName }: { insight: Insight; petName?: string }) {
  const { updateInsight } = useHousehold();

  const act = async (action: 'acknowledge' | 'dismiss') => {
    const updated = action === 'acknowledge' ? await api.acknowledgeInsight(insight.id) : await api.dismissInsight(insight.id);
    updateInsight(updated);
  };

  const resolved = insight.acknowledged_status === 'acknowledged' || insight.acknowledged_status === 'dismissed';

  return (
    <article
      className={`rounded-2xl border bg-card p-4 shadow-sm transition-opacity ${
        insight.urgency === 'emergency' ? 'border-tier-emergency/40' : 'border-black/5'
      } ${resolved ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <UrgencyBadge urgency={insight.urgency} />
        {petName &&
          (insight.pet_id ? (
            <Link to={`/pets/${insight.pet_id}`} className="text-sm font-bold hover:underline">
              {petName}
            </Link>
          ) : (
            <span className="text-sm font-bold">{petName}</span>
          ))}
        <span className="text-xs text-gray-500 capitalize">{insight.insight_type.replace('_', ' ')}</span>
        {Boolean(insight.routed_to_associate) && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-0.5 text-xs font-bold text-brand">
            🚚 Associate alerted
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed">{insight.summary}</p>
      <p className="mt-2 rounded-xl bg-cream px-3 py-2 text-sm font-semibold">
        <span aria-hidden>👉 </span>
        {insight.recommended_action}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <time>{new Date(insight.generated_at).toLocaleString()}</time>
        <span className="capitalize">· {insight.acknowledged_status}</span>
        {insight.insight_type === 'pet_health' &&
          (insight.urgency === 'urgent' || insight.urgency === 'emergency') &&
          insight.pet_id && (
            <Link
              to={`/pets/${insight.pet_id}/vet-report`}
              className="rounded-full bg-brand px-3 py-1 font-bold text-brand-ink hover:bg-brand-dark"
            >
              📤 Share with vet
            </Link>
          )}
        {!resolved && (
          <span className="ml-auto flex gap-2">
            <button
              onClick={() => void act('acknowledge')}
              className="rounded-full bg-navy px-3 py-1 font-bold text-white hover:opacity-80"
            >
              Got it
            </button>
            <button
              onClick={() => void act('dismiss')}
              className="rounded-full border border-black/10 px-3 py-1 font-bold hover:bg-cream"
            >
              Dismiss
            </button>
          </span>
        )}
      </div>
    </article>
  );
}
