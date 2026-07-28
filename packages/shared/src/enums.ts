export const URGENCY_TIERS = ['info', 'monitor', 'attention', 'urgent', 'emergency'] as const;
export type Urgency = (typeof URGENCY_TIERS)[number];

export const INSIGHT_TYPES = ['pet_health', 'pet_safety', 'equipment'] as const;
export type InsightType = (typeof INSIGHT_TYPES)[number];

export const DEVICE_TYPES = ['containment_collar', 'feeder', 'fountain'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const SPECIES = ['dog', 'cat', 'other'] as const;
export type Species = (typeof SPECIES)[number];

export const ASSIGNMENT_MODES = ['dedicated', 'shared'] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export const DEVICE_STATUSES = ['active', 'low_battery', 'offline', 'needs_service'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const ACK_STATUSES = ['unseen', 'seen', 'acknowledged', 'dismissed'] as const;
export type AckStatus = (typeof ACK_STATUSES)[number];

export const BASELINE_STATUSES = ['insufficient_data', 'established'] as const;
export type BaselineStatus = (typeof BASELINE_STATUSES)[number];

/** Event types the platform knows how to score. Unknown types are stored + flagged, never rejected. */
export const KNOWN_EVENT_TYPES = [
  'boundary_check',
  'boundary_event',
  'heart_rate_reading',
  'activity_session',
  'sleep_session',
  'drinking_session',
  'feeding_session',
  'device_health_ping',
] as const;
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

export const METRICS = [
  'resting_heart_rate',
  'walk_minutes',
  'water_intake_ml',
  'food_intake_g',
  'sleep_hours',
  'feeder_schedule_drift_min',
  'fountain_flow_rate',
  'collar_battery_pct',
  'boundary_safety',
  'containment_signal',
] as const;
export type Metric = (typeof METRICS)[number];

export function urgencyRank(u: Urgency): number {
  return URGENCY_TIERS.indexOf(u);
}

export function maxUrgency(a: Urgency, b: Urgency): Urgency {
  return urgencyRank(a) >= urgencyRank(b) ? a : b;
}
