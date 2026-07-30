import type { EcosystemLine } from './types';

/**
 * The connected-assortment catalog: what's live in the platform today and the
 * reasonable, logical breadth of what joins it next. Served by GET /v1/ecosystem
 * (public reference, like /v1/meta); clients mark lines "in your home" by
 * matching device_type against the household's devices. Every line — live or
 * coming — plugs into the same telemetry envelope with zero new endpoints.
 */
export const ECOSYSTEM_LINES: EcosystemLine[] = [
  // Safety & containment
  { category: 'Safety & containment', name: 'Boundary Plus GPS collar', tagline: 'The invisible fence, live on a map — with breach response in seconds.', status: 'live', device_type: 'containment_collar', icon: '📡' },
  { category: 'Safety & containment', name: 'Yard Predator Watch', tagline: 'Camera + species recognition: deter coyotes and raccoons, lock the pet door automatically.', status: 'coming_soon', device_type: null, icon: '🦝' },
  { category: 'Safety & containment', name: 'Anywhere GPS + lost-pet network', tagline: 'Walk mode, escape recovery, and a community of collars that helps bring pets home.', status: 'coming_soon', device_type: null, icon: '🛰️' },
  { category: 'Safety & containment', name: 'Pool & water safety sensor', tagline: 'An immersion alert the moment a pet enters the water.', status: 'coming_soon', device_type: null, icon: '🏊' },

  // Access & doors
  { category: 'Access & doors', name: 'SmartDoor Connect', tagline: 'Per-pet access, curfew schedules, remote lock, and a log of every coming and going.', status: 'live', device_type: 'smart_door', icon: '🚪' },
  { category: 'Access & doors', name: 'Indoor access zones', tagline: 'RFID room gates and feeding-station flaps — the dog stays out of the cat food.', status: 'coming_soon', device_type: null, icon: '🚧' },

  // Feeding & hydration
  { category: 'Feeding & hydration', name: 'Smart Feeder', tagline: 'Scheduled meals with per-pet attribution and drift detection.', status: 'live', device_type: 'feeder', icon: '🍽️' },
  { category: 'Feeding & hydration', name: 'Smart Fountain', tagline: 'Hydration tracking with filter-life monitoring and auto-replenishment.', status: 'live', device_type: 'fountain', icon: '⛲' },
  { category: 'Feeding & hydration', name: 'RFID portion-control feeder', tagline: 'Prescription-diet enforcement in multi-pet homes — each bowl opens for one pet.', status: 'coming_soon', device_type: null, icon: '🥣' },
  { category: 'Feeding & hydration', name: 'Smart food bin', tagline: 'Inventory tracking that reorders before the scoop hits the bottom.', status: 'coming_soon', device_type: null, icon: '🛢️' },

  // Health & wellness
  { category: 'Health & wellness', name: 'Smart Litter Box', tagline: 'Visit frequency, duration, and weight — the earliest urinary and kidney signals cats hide.', status: 'live', device_type: 'litter_box', icon: '🧺' },
  { category: 'Health & wellness', name: 'Smart bed vitals', tagline: 'Non-wearable resting heart rate, respiration, and sleep quality — perfect for cats and seniors.', status: 'coming_soon', device_type: null, icon: '🛏️' },
  { category: 'Health & wellness', name: 'Medication dispenser', tagline: 'Timed dosing with confirmation events that flow straight into the vet report.', status: 'coming_soon', device_type: null, icon: '💊' },

  // Comfort & engagement
  { category: 'Comfort & engagement', name: 'Treat cam', tagline: 'Check in from anywhere, toss a treat, and track enrichment while you are out.', status: 'coming_soon', device_type: null, icon: '🎥' },
  { category: 'Comfort & engagement', name: 'Kennel & catio climate', tagline: 'Heatstroke prevention and air-quality alerts for outdoor spaces.', status: 'coming_soon', device_type: null, icon: '🌡️' },
];
