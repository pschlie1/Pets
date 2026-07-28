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
  'urgent_baxter_heart',
  'emergency_boundary_breach',
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
      "Wrigley's water intake runs 5% below her baseline on a cooler day — inside her normal range and the breed's.",
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
  urgent_baxter_heart: {
    key: 'urgent_baxter_heart',
    name: "Baxter's heart rate trend",
    description:
      "Baxter's resting heart rate runs 15% above his own baseline for three days, with shorter walks. Wrigley stays normal — ruling out a shared cause.",
    expectedUrgency: 'urgent',
    insightType: 'pet_health',
    watchFor:
      "Sibling divergence upgrades severity. Breed cardiac risk at age 9 makes it urgent — with a specific vet recommendation.",
  },
  emergency_boundary_breach: {
    key: 'emergency_boundary_breach',
    name: 'Boundary breach + no motion',
    description:
      "Wrigley's collar reports a boundary breach, then an extended period of no motion outside the safe zone.",
    expectedUrgency: 'emergency',
    insightType: 'pet_safety',
    watchFor:
      'Immediate emergency insight, emergency vet contact surfaced, and the dealer associate alerted in parallel.',
  },
};

export const SCENARIO_LIST: ScenarioMeta[] = SCENARIO_KEYS.map((k) => SCENARIOS[k]);
