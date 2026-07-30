import type { Dealer } from './types';

/**
 * Consumables catalog + dealer directory. Shared constants for the same reason
 * as YARD_GEOMETRIES: one source of truth across seed, API, and web without a
 * demo schema migration.
 *
 * PRODUCTION NOTE: the catalog lives in the commerce platform and dealers come
 * from the dealer CRM; the API contracts here stay the same.
 */

export interface Consumable {
  sku: string;
  label: string;
  price_cents: number;
  device_type: 'fountain' | 'containment_collar' | 'feeder' | 'smart_door' | 'litter_box';
}

export const CONSUMABLES: Consumable[] = [
  { sku: 'filt-std-4pk', label: 'Fountain filter 4-pack', price_cents: 1299, device_type: 'fountain' },
  { sku: 'batt-rfa-67', label: 'Collar battery 2-pack', price_cents: 2499, device_type: 'containment_collar' },
  { sku: 'litter-clump-28', label: 'Clumping litter 28 lb', price_cents: 1899, device_type: 'litter_box' },
  { sku: 'batt-door-4aa', label: 'Door battery 4-pack', price_cents: 999, device_type: 'smart_door' },
];

export function consumableForDevice(deviceType: string): Consumable | null {
  return CONSUMABLES.find((c) => c.device_type === deviceType) ?? null;
}

export const DEALERS: Record<string, Dealer> = {
  hh_2291: {
    name: 'Invisible Fence Brand — Chicago North',
    associate: 'Dana M.',
    phone: '(312) 555-0148',
  },
};
