import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useHousehold } from '../state/HouseholdContext';
import { UrgencyBadge } from './UrgencyBadge';

/** Pops when a new insight arrives over the SSE stream. */
export function Toast() {
  const { toast, clearToast } = useHousehold();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 6000);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  if (!toast) return null;

  return (
    <Link
      to="/insights"
      onClick={clearToast}
      className="fixed bottom-6 right-6 z-50 w-96 max-w-[90vw] rounded-2xl border border-black/10 bg-card p-4 shadow-xl transition hover:shadow-2xl"
    >
      <div className="flex items-center gap-2">
        <UrgencyBadge urgency={toast.urgency} />
        <span className="text-xs font-bold text-gray-500">New insight</span>
      </div>
      <p className="mt-1 line-clamp-3 text-sm">{toast.summary}</p>
    </Link>
  );
}
