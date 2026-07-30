import { useEffect, useState } from 'react';
import type { DoorActivity } from '@connected-care/shared';
import { api } from '../api/client';
import { useHousehold } from '../state/HouseholdContext';
import { PetAvatar } from './PetAvatar';

/** The SmartDoor's log: who went in or out over the last 24 hours. */
export function ComingsGoings({ refreshKey }: { refreshKey: number }) {
  const { household } = useHousehold();
  const [activity, setActivity] = useState<DoorActivity | null>(null);

  useEffect(() => {
    void api.getDoorActivity(24).then(setActivity).catch(() => setActivity(null));
  }, [refreshKey]);

  if (!activity) return null;
  const pet = (id: string | null) => household?.pets.find((p) => p.id === id);

  return (
    <section className="rounded-2xl bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-gray-400">🚪 Comings & goings</h2>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${
            activity.settings.locked ? 'bg-tier-emergency-soft text-tier-emergency' : 'bg-safe-soft text-safe'
          }`}
        >
          {activity.settings.locked ? '🔒 Door locked' : '🔓 Door unlocked'}
        </span>
        {activity.settings.curfew_start && (
          <span className="rounded-full bg-cream px-2.5 py-0.5 text-xs font-bold text-gray-500">
            🌙 Curfew {activity.settings.curfew_start}–{activity.settings.curfew_end}
          </span>
        )}
      </div>
      {activity.entries.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No door activity in the last 24 hours.</p>
      ) : (
        <ol className="mt-3 max-h-56 space-y-2 overflow-y-auto">
          {activity.entries.slice(0, 20).map((e, i) => {
            const p = pet(e.pet_id);
            return (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                {p ? (
                  <PetAvatar petId={p.id} species={p.species} hasPhoto={p.has_photo} size="sm" />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-cream" aria-hidden>
                    ❓
                  </span>
                )}
                <span>
                  <span className="font-bold">{e.pet_name ?? 'Unrecognized tag'}</span>{' '}
                  {e.direction === 'out' ? 'went out' : 'came in'}{' '}
                  <span aria-hidden>{e.direction === 'out' ? '↗️' : '↘️'}</span>
                  <time className="block text-xs text-gray-400">{new Date(e.occurred_at).toLocaleString()}</time>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
