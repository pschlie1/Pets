import { useEffect, useState } from 'react';
import type { DoorSettings } from '@connected-care/shared';
import { api } from '../api/client';

/**
 * "Control when it opens": lock/unlock now, and the overnight curfew window.
 * Every change round-trips through PATCH /v1/devices/:id/settings, which also
 * writes a door_status audit event into the telemetry record.
 */
export function DoorControls({ deviceId }: { deviceId: string }) {
  const [settings, setSettings] = useState<DoorSettings | null>(null);
  const [draftStart, setDraftStart] = useState('22:00');
  const [draftEnd, setDraftEnd] = useState('06:00');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void api
      .getDoorActivity(1)
      .then((a) => {
        setSettings(a.settings);
        if (a.settings.curfew_start) setDraftStart(a.settings.curfew_start);
        if (a.settings.curfew_end) setDraftEnd(a.settings.curfew_end);
      })
      .catch(() => setSettings(null));
  }, [deviceId]);

  if (!settings) return null;

  const save = (next: DoorSettings, message: string) => {
    setBusy(true);
    void api
      .setDoorSettings(deviceId, next)
      .then((r) => {
        setSettings(r.settings);
        setNote(message);
        setTimeout(() => setNote(null), 3000);
      })
      .catch((e: Error) => setNote(`⚠️ ${e.message}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 rounded-xl bg-cream p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={busy}
          onClick={() =>
            save({ ...settings, locked: !settings.locked }, settings.locked ? 'Door unlocked 🔓' : 'Door locked 🔒')
          }
          className={`rounded-full px-4 py-1.5 text-sm font-extrabold disabled:opacity-40 ${
            settings.locked ? 'bg-tier-emergency text-white' : 'bg-navy text-white'
          }`}
        >
          {settings.locked ? '🔒 Locked — tap to unlock' : '🔓 Unlocked — tap to lock'}
        </button>
        {note && <span className="text-xs font-bold text-safe">{note}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-600">
        <span>🌙 Curfew</span>
        <input
          type="time"
          value={draftStart}
          onChange={(e) => setDraftStart(e.currentTarget.value)}
          className="rounded-lg border border-black/10 bg-card px-2 py-1"
          aria-label="Curfew start"
        />
        <span>to</span>
        <input
          type="time"
          value={draftEnd}
          onChange={(e) => setDraftEnd(e.currentTarget.value)}
          className="rounded-lg border border-black/10 bg-card px-2 py-1"
          aria-label="Curfew end"
        />
        <button
          disabled={busy}
          onClick={() => save({ ...settings, curfew_start: draftStart, curfew_end: draftEnd }, 'Curfew updated 🌙')}
          className="rounded-full bg-brand px-3 py-1 font-extrabold text-brand-ink hover:bg-brand-dark disabled:opacity-40"
        >
          Save
        </button>
        <span className="text-gray-400">
          {settings.curfew_start ? `Locked ${settings.curfew_start}–${settings.curfew_end} nightly` : 'No curfew set'}
        </span>
      </div>
    </div>
  );
}
