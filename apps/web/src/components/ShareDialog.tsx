import { useState } from 'react';
import type { VetShare } from '@connected-care/shared';
import { api } from '../api/client';

/**
 * The digital "Send to my vet" flow. Recipient pre-filled with a demo clinic;
 * the share is recorded server-side and confirmed in place.
 */
export function ShareDialog({
  petId,
  petName,
  onShared,
  onClose,
}: {
  petId: string;
  petName: string;
  onShared: (share: VetShare) => void;
  onClose: () => void;
}) {
  const [recipient, setRecipient] = useState('Lincoln Park Veterinary Clinic');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const send = async () => {
    if (!recipient.trim() || state === 'sending') return;
    setState('sending');
    try {
      const share = await api.shareVetReport(petId, { recipient: recipient.trim(), method: 'portal' });
      onShared(share);
      setState('sent');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-charcoal/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {state === 'sent' ? (
          <div className="text-center">
            <p className="text-3xl" aria-hidden>
              ✅
            </p>
            <h2 className="mt-2 text-lg font-extrabold">Sent to {recipient}</h2>
            <p className="mt-1 text-sm text-gray-500">
              Your vet can view {petName}'s report in their portal. The share is recorded below the report.
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded-full bg-charcoal px-5 py-2 font-extrabold text-white hover:opacity-85"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-extrabold">Send {petName}'s report to your vet</h2>
            <p className="mt-1 text-sm text-gray-500">
              The live report — summary, trends, baselines, and active insights — is shared digitally with your clinic.
            </p>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-gray-400">
              Veterinary clinic
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2.5 text-sm font-semibold normal-case tracking-normal text-charcoal outline-none focus:border-brand"
              />
            </label>
            <p className="mt-2 text-xs text-gray-400">
              Demo environment: the share is recorded, no data leaves this demo. Production connects to real vet
              portals.
            </p>
            {state === 'error' && (
              <p className="mt-2 text-sm font-bold text-tier-urgent">Something went wrong — please try again.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-full border border-black/10 px-4 py-2 text-sm font-bold hover:bg-cream">
                Cancel
              </button>
              <button
                onClick={() => void send()}
                disabled={state === 'sending' || !recipient.trim()}
                className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-charcoal hover:bg-brand-dark disabled:opacity-40"
              >
                {state === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
