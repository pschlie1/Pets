import { useEffect, useState } from 'react';
import type { Consumable, Order } from '@connected-care/shared';
import { api } from '../api/client';

/**
 * One-tap consumable replenishment. The catalog (label, price, sku) comes
 * from the API — never from anything bundled into the app — so every client
 * shows exactly what the platform charges. Once an order exists (placed here
 * or earlier), the CTA shows its ETA instead and can never double-order.
 */
export function OrderButton({ deviceId, deviceType }: { deviceId: string; deviceType: string }) {
  const [consumable, setConsumable] = useState<Consumable | null | undefined>(undefined);
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .getConsumables()
      .then((catalog) => {
        const match = catalog.find((c) => c.device_type === deviceType) ?? null;
        setConsumable(match);
        if (!match) return setOrder(null);
        void api
          .getOrders()
          .then((orders) => setOrder(orders.find((o) => o.device_id === deviceId && o.sku === match.sku) ?? null))
          .catch(() => setOrder(null));
      })
      .catch(() => setConsumable(null));
  }, [deviceId, deviceType]);

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
