import type { Db } from '../db/connection';

/**
 * Extracts daily metric values for a pet from raw telemetry. Each metric maps
 * to one number per day; baselines and scoring both consume these series.
 */

interface EventRow {
  event_type: string;
  payload: string;
  occurred_at: string;
}

/**
 * Keyed by rolling 24h bucket relative to evaluation time: 0 = the last 24h,
 * 1 = the 24h before that. Rolling buckets (rather than calendar dates) mean
 * an in-progress day never reads as an artificially low total.
 */
export type DailySeries = Map<number, number>;

export const PET_METRICS = [
  'resting_heart_rate',
  'walk_minutes',
  'water_intake_ml',
  'food_intake_g',
  'sleep_hours',
  'litter_visits_per_day',
  'door_crossings_per_day',
] as const;
export type PetMetric = (typeof PET_METRICS)[number];

export function dailyMetricSeries(
  db: Db,
  petId: string,
  metric: PetMetric,
  sinceIso: string,
  nowMs: number,
): DailySeries {
  const eventType = {
    resting_heart_rate: 'heart_rate_reading',
    walk_minutes: 'activity_session',
    water_intake_ml: 'drinking_session',
    food_intake_g: 'feeding_session',
    sleep_hours: 'sleep_session',
    litter_visits_per_day: 'litter_visit',
    door_crossings_per_day: 'door_passage',
  }[metric];

  const rows = db
    .prepare(
      `SELECT event_type, payload, occurred_at FROM telemetry_events
       WHERE pet_id = ? AND event_type = ? AND occurred_at >= ? ORDER BY occurred_at`,
    )
    .all(petId, eventType, sinceIso) as EventRow[];

  // Averaged metrics accumulate {sum, count}; summed metrics accumulate totals.
  const averaged = metric === 'resting_heart_rate' || metric === 'sleep_hours';
  const acc = new Map<number, { sum: number; count: number }>();
  const DAY = 86_400_000;

  for (const row of rows) {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    let value: number | null = null;
    switch (metric) {
      case 'resting_heart_rate':
        if (payload.activity_state === 'resting' && typeof payload.bpm === 'number') value = payload.bpm;
        break;
      case 'walk_minutes':
        if (typeof payload.duration_minutes === 'number') value = payload.duration_minutes;
        break;
      case 'water_intake_ml':
        if (typeof payload.estimated_volume_ml === 'number') value = payload.estimated_volume_ml;
        break;
      case 'food_intake_g':
        if (typeof payload.grams_consumed === 'number') value = payload.grams_consumed;
        break;
      case 'sleep_hours':
        if (typeof payload.duration_hours === 'number') value = payload.duration_hours;
        break;
      // Count metrics: every event contributes 1; the daily sum IS the count.
      case 'litter_visits_per_day':
        value = 1;
        break;
      case 'door_crossings_per_day':
        value = payload.direction === 'out' ? 1 : null; // count trips, not both swings
        break;
    }
    if (value === null) continue;
    const day = Math.max(Math.floor((nowMs - Date.parse(row.occurred_at)) / DAY), 0);
    const entry = acc.get(day) ?? { sum: 0, count: 0 };
    entry.sum += value;
    entry.count += 1;
    acc.set(day, entry);
  }

  const series: DailySeries = new Map();
  for (const [day, { sum, count }] of acc) {
    series.set(day, averaged ? sum / count : sum);
  }
  return series;
}

export function meanStdev(values: number[]): { mean: number; stdev: number } {
  if (values.length === 0) return { mean: 0, stdev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stdev: Math.sqrt(variance) };
}
