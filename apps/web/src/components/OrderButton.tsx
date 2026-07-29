import { useEffect, useState } from 'react';
import { consumableForDevice, type Order } from '@connected-care/shared';
import { api } from '../api/client';

/**
 * One-tap consumable replenishment. Shows the matching consumable for the
 * device; once an order exists (placed here or earlier), shows its ETA
 * instead — the CTA can never double-order.
 */
export function OrderButton({ deviceId, deviceType }: { deviceId: string; deviceType: string }) {
  const consumable = consumableForDevice(deviceType);
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!consumable) return;
    void api
      .getOrders()
      .then((orders) => setOrder(orders.find((o) => o.device_id === deviceId && o.sku === consumable.sku) ?? null))
      .catch(() => setOrder(null));
  }, [deviceId, consumable?.sku]);

  if (!consumable || order === undefined) return null;

  if (order) {
    const eta = new Date(`${order.eta_date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return (
      <span className="inline-flex items-center rounded-full bg-safe-soft px-3 py-1 text-xs font-bold text-safe">
        ✓ {order.label} on the way · arrives {eta}
      </span>
    );
  }

  return (
    <button
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void api
          .placeOrder(deviceId, consumable.sku)
          .then(setOrder)
          .finally(() => setBusy(false));
      }}
      className="rounded-full bg-brand px-3 py-1 text-xs font-bold text-brand-ink hover:bg-brand-dark disabled:opacity-40"
    >
      {busy ? 'Ordering…' : `🛒 Order ${consumable.label.toLowerCase()} — $${(consumable.price_cents / 100).toFixed(2)}`}
    </button>
  );
}
