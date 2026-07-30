import type { InsightType, Urgency } from './enums';

/**
 * The six showcase anomaly scenarios from the PRD, shared between the API's
 * scenario injectors and the demo control panel so they can never drift apart.
 */
export const SCENARIO_KEYS = [
  'info_water_dip',
  'monitor_feeder_drift',
  'attention_cold_snap',
  'attention_fountain_filter',
  'urgent_meeko_heart',
  'breach_safe_return',
  'collar_signal_lost',
  'collar_battery_critical',
  'emergency_boundary_breach',
  'door_raccoon_lockout',
  'litter_visits_spike',
] as const;
export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

export interface ScenarioMeta {
  key: ScenarioKey;
  name: string;
  description: string;
  expectedUrgency: Urgency;
  insightType: InsightType;
  watchFor: string;
}

export const SCENARIOS: Record<ScenarioKey, ScenarioMeta> = {
  info_water_dip: {
    key: 'info_water_dip',
    name: 'Small water dip',
    description:
      "Lilo's water intake runs 5% below her baseline on a cooler day — inside her normal range and the breed's.",
    expectedUrgency: 'info',
    insightType: 'pet_health',
    watchFor: 'Logged quietly. No push, no alarm — visible only if you go looking.',
  },
  monitor_feeder_drift: {
    key: 'monitor_feeder_drift',
    name: 'Feeder schedule drift',
    description:
      "The feeder's scheduled dispense runs three minutes late, twice in one week. Not yet a pattern.",
    expectedUrgency: 'monitor',
    insightType: 'equipment',
    watchFor: 'Logged for the next review cycle — no push notification.',
  },
  attention_cold_snap: {
    key: 'attention_cold_snap',
    name: 'Chicago cold snap',
    description:
      "Both dogs' fountain visits drop together during a sub-10°F cold snap. Weather explains the shared change.",
    expectedUrgency: 'attention',
    insightType: 'pet_health',
    watchFor:
      'One calm, downgraded household insight instead of two alarms — the sibling check + weather context at work.',
  },
  attention_fountain_filter: {
    key: 'attention_fountain_filter',
    name: 'Fountain filter wearing out',
    description: "The fountain's flow rate has declined 30% over five days — a filter near end of life.",
    expectedUrgency: 'attention',
    insightType: 'equipment',
    watchFor: 'An equipment insight suggesting a filter order, not a pet health alarm.',
  },
  urgent_meeko_heart: {
    key: 'urgent_meeko_heart',
    name: "Meeko's heart rate trend",
    description:
      "Meeko's resting heart rate runs 15% above his own baseline for three days, with shorter walks. Lilo stays normal — ruling out a shared cause.",
    expectedUrgency: 'urgent',
    insightType: 'pet_health',
    watchFor:
      "Sibling divergence upgrades severity. Breed cardiac risk at age 9 makes it urgent — with a specific vet recommendation.",
  },
  breach_safe_return: {
    key: 'breach_safe_return',
    name: 'Brief breach, safe return',
    description:
      'Meeko steps past the boundary but keeps moving the whole time and returns to the safe zone on his own within minutes.',
    expectedUrgency: 'monitor',
    insightType: 'pet_safety',
    watchFor:
      'A calm logged note instead of an alarm — motion + quick return means no panic, just a pattern worth tracking.',
  },
  collar_signal_lost: {
    key: 'collar_signal_lost',
    name: 'Collar signal lost',
    description:
      "Lilo's collar stops checking in. The system notices the silence itself: containment can no longer be verified.",
    expectedUrgency: 'attention',
    insightType: 'pet_safety',
    watchFor:
      "An honest 'we can't verify the fence right now' — the system watches the watchers instead of showing a false all-clear.",
  },
  collar_battery_critical: {
    key: 'collar_battery_critical',
    name: 'Collar battery critical',
    description:
      "Meeko's collar battery drains to 12%. Below this level boundary corrections may not deliver.",
    expectedUrgency: 'urgent',
    insightType: 'equipment',
    watchFor:
      'A maintenance ticket becomes a safety gap: urgency reflects the containment exposure, not just the dying battery.',
  },
  emergency_boundary_breach: {
    key: 'emergency_boundary_breach',
    name: 'Boundary breach + no motion',
    description:
      "Lilo's collar reports a boundary breach, then an extended period of no motion outside the safe zone.",
    expectedUrgency: 'emergency',
    insightType: 'pet_safety',
    watchFor:
      'Immediate emergency insight, emergency vet contact surfaced, and the dealer associate alerted in parallel.',
  },
  door_raccoon_lockout: {
    key: 'door_raccoon_lockout',
    name: 'Raccoon at the pet door',
    description:
      'At 2 AM the SmartDoor recognizes an approaching raccoon, locks itself, and logs the deterrence.',
    expectedUrgency: 'attention',
    insightType: 'pet_safety',
    watchFor:
      "A calm 'the system already handled it' insight and a locked-door entry in the comings & goings log — protection without a 3 AM panic.",
  },
  litter_visits_spike: {
    key: 'litter_visits_spike',
    name: "Stitch's litter box visits spike",
    description:
      "Stitch's litter box visits run well above his own baseline for three days — the classic early feline urinary signal.",
    expectedUrgency: 'urgent',
    insightType: 'pet_health',
    watchFor:
      'Cat-specific health monitoring: an urgent insight with a vet recommendation, built from a product only a cat household has.',
  },
};

export const SCENARIO_LIST: ScenarioMeta[] = SCENARIO_KEYS.map((k) => SCENARIOS[k]);
