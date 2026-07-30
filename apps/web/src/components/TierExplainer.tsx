import { UrgencyBadge } from './UrgencyBadge';
import { useMeta } from '../state/MetaContext';

/**
 * The five urgency levels in customer language — served by /v1/meta so every
 * presentation layer explains the tiers with exactly the same words.
 */
export function TierExplainer() {
  const { urgency_tiers } = useMeta();
  return (
    <details className="rounded-2xl bg-card p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-extrabold text-gray-500 hover:text-charcoal">
        What do these levels mean?
      </summary>
      <ul className="mt-3 space-y-3">
        {urgency_tiers.map((tier) => (
          <li key={tier.key} className="flex flex-col gap-1 border-t border-black/5 pt-3 text-sm sm:flex-row sm:gap-4">
            <span className="shrink-0 sm:w-28">
              <UrgencyBadge urgency={tier.key} />
            </span>
            <span className="space-y-0.5 text-gray-600">
              <span className="block">
                <span className="font-bold text-charcoal">What we saw:</span> {tier.explainer.what_we_saw}
              </span>
              <span className="block">
                <span className="font-bold text-charcoal">What we do:</span> {tier.explainer.what_we_do}
              </span>
              <span className="block">
                <span className="font-bold text-charcoal">What you should do:</span> {tier.explainer.what_you_do}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
