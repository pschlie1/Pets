import { Router } from 'express';
import { CONSUMABLES, consumableForDevice, orderSchema, type Order } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { assertHousehold, deviceHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

/**
 * Proactive replenishment: one-tap consumable orders placed from equipment
 * insights. PRODUCTION NOTE: this hands off to the commerce platform; the demo
 * records the order and confirms an ETA without fulfillment.
 */
export function orderRoutes(db: Db): Router {
  const r = Router();

  // Reference data, like /v1/breeds: the client renders prices and labels
  // from here — never from anything bundled into the app.
  r.get('/catalog/consumables', (_req, res) => {
    res.json({ data: CONSUMABLES });
  });

  r.post('/orders', validate(orderSchema), (req, res) => {
    const { device_id, sku } = req.body as { device_id: string; sku: string };
    const householdId = deviceHousehold(db, device_id);
    assertHousehold(req, householdId);

    const device = db.prepare(`SELECT device_type FROM devices WHERE id = ?`).get(device_id) as {
      device_type: string;
    };
    const consumable = consumableForDevice(device.device_type);
    if (!consumable || consumable.sku !== sku) {
      throw new ApiError(400, 'validation_error', `sku ${sku} does not fit this device.`);
    }

    const id = uuid();
    const eta = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    db.prepare(
      `INSERT INTO orders (id, household_id, device_id, sku, label, price_cents, eta_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, householdId, device_id, sku, consumable.label, consumable.price_cents, eta);

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as Order;
    res.status(201).json({ data: order });
  });

  r.get('/households/:id/orders', (req, res) => {
    assertHousehold(req, req.params.id);
    const orders = db
      .prepare(`SELECT * FROM orders WHERE household_id = ? ORDER BY created_at DESC`)
      .all(req.params.id) as Order[];
    res.json({ data: orders });
  });

  return r;
}
