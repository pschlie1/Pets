import { URGENCY_TIERS, type Urgency } from '@connected-care/shared';
import { UrgencyBadge } from './UrgencyBadge';

/**
 * The five urgency levels in customer language. Wording mirrors the agent
 * templates so the product speaks with one voice.
 */
const COPY: Record<Urgency, { saw: string; weDo: string; youDo: string }> = {
  info: {
    saw: "Readings comfortably inside your pet's own normal range.",
    weDo: 'Keep logging quietly in the background.',
    youDo: 'Nothing — enjoy your day.',
  },
  monitor: {
    saw: 'A single reading outside the usual range — a blip, not a pattern.',
    weDo: 'Re-check automatically on the next cycle and only escalate if it repeats.',
    youDo: "Nothing yet — we're watching it for you.",
  },
  attention: {
    saw: 'A few days of drift from baseline, often with an everyday explanation like hot weather.',
    weDo: 'Compare against the rest of the household and local conditions to rule out simple causes.',
    youDo: 'Keep an eye on your pet and check back in a few days.',
  },
  urgent: {
    saw: "A sustained pattern well outside your pet's own baseline with no everyday explanation.",
    weDo: 'Assemble the data into a report you can share with your vet.',
    youDo: 'Schedule a vet visit and bring the report — this is pattern detection from device data, not a diagnosis.',
  },
  emergency: {
    saw: 'A safety-critical event, like a pet outside the boundary and not moving.',
    weDo: 'Alert you immediately and notify your local dealer associate in parallel.',
    youDo: "Go to your pet now, and call your emergency vet if they're unresponsive.",
  },
};

export function TierExplainer() {
  return (
    <details className="rounded-2xl bg-card p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-extrabold text-gray-500 hover:text-charcoal">
        What do these levels mean?
      </summary>
      <ul className="mt-3 space-y-3">
        {URGENCY_TIERS.map((tier) => (
          <li key={tier} className="flex flex-col gap-1 border-t border-black/5 pt-3 text-sm sm:flex-row sm:gap-4">
            <span className="shrink-0 sm:w-28">
              <UrgencyBadge urgency={tier} />
            </span>
            <span className="space-y-0.5 text-gray-600">
              <span className="block">
                <span className="font-bold text-charcoal">What we saw:</span> {COPY[tier].saw}
              </span>
              <span className="block">
                <span className="font-bold text-charcoal">What we do:</span> {COPY[tier].weDo}
              </span>
              <span className="block">
                <span className="font-bold text-charcoal">What you should do:</span> {COPY[tier].youDo}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
