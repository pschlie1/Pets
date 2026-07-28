import type { Urgency } from '@connected-care/shared';

const STYLES: Record<Urgency, { bg: string; text: string; icon: string; label: string }> = {
  info: { bg: 'bg-gray-100', text: 'text-tier-info', icon: '✓', label: 'Info' },
  monitor: { bg: 'bg-sky-50', text: 'text-tier-monitor', icon: '👀', label: 'Monitor' },
  attention: { bg: 'bg-amber-50', text: 'text-tier-attention', icon: '💡', label: 'Attention' },
  urgent: { bg: 'bg-orange-50', text: 'text-tier-urgent', icon: '❗', label: 'Urgent' },
  emergency: { bg: 'bg-red-50', text: 'text-tier-emergency', icon: '🚨', label: 'Emergency' },
};

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  const s = STYLES[urgency];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${s.bg} ${s.text}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}
