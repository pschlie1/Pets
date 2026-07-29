import type { Milestone } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { dailyMetricSeries } from './aggregates';

/**
 * Wins worth celebrating, computed live from the telemetry record — never
 * stored, so a reset or scenario immediately changes them. Rolling 24h
 * buckets, matching the rest of the engine.
 */

const DAY = 86_400_000;
const WINDOW_DAYS = 21;

export function getMilestones(db: Db, householdId: string, now: number = Date.now()): Milestone[] {
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const pets = db
    .prepare(`SELECT id, name FROM pets WHERE household_id = ? AND deleted_at IS NULL`)
    .all(householdId) as { id: string; name: string }[];
  const wins: Milestone[] = [];

  // Walk streak: consecutive rolling days (starting yesterday-ish, bucket 1)
  // with at least 20 minutes of walks. Bucket 0 is in progress, so it can
  // extend but never break a streak.
  for (const pet of pets) {
    const walks = dailyMetricSeries(db, pet.id, 'walk_minutes', since, now);
    let streak = 0;
    for (let d = 1; d < WINDOW_DAYS; d++) {
      if ((walks.get(d) ?? 0) >= 20) streak++;
      else break;
    }
    if ((walks.get(0) ?? 0) >= 20) streak++;
    if (streak >= 3) {
      wins.push({
        icon: '🚶',
        title: `${streak}-day walk streak`,
        detail: `${pet.name} has logged 20+ minutes of walks ${streak} days running`,
        pet_id: pet.id,
      });
    }
  }

  // Breach-free run: days since the last boundary breach anywhere in the household.
  const lastBreach = db
    .prepare(
      `SELECT occurred_at FROM telemetry_events
       WHERE household_id = ? AND event_type = 'boundary_event'
         AND json_extract(payload, '$.status') = 'breach'
       ORDER BY occurred_at DESC LIMIT 1`,
    )
    .get(householdId) as { occurred_at: string } | undefined;
  const hasCollars = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM devices
       WHERE household_id = ? AND device_type = 'containment_collar' AND deleted_at IS NULL`,
    )
    .get(householdId) as { n: number }).n;
  if (hasCollars > 0) {
    const breachFreeDays = lastBreach
      ? Math.floor((now - Date.parse(lastBreach.occurred_at)) / DAY)
      : WINDOW_DAYS;
    if (breachFreeDays >= 3) {
      wins.push({
        icon: '🛡️',
        title: `${breachFreeDays}${lastBreach ? '' : '+'} days breach-free`,
        detail: 'Nobody has crossed the boundary — the fence is doing its quiet work',
        pet_id: null,
      });
    }
  }

  // Hydration: days on baseline (within ±20% of the 14-day mean) out of the last 7.
  for (const pet of pets) {
    const water = dailyMetricSeries(db, pet.id, 'water_intake_ml', since, now);
    const values = [...water.values()];
    if (values.length < 7) continue;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (mean <= 0) continue;
    let onBaseline = 0;
    for (let d = 1; d <= 7; d++) {
      const v = water.get(d);
      if (v !== undefined && Math.abs(v - mean) / mean <= 0.2) onBaseline++;
    }
    if (onBaseline >= 6) {
      wins.push({
        icon: '💧',
        title: 'Hydration on point',
        detail: `${pet.name} drank a steady, on-baseline amount ${onBaseline} of the last 7 days`,
        pet_id: pet.id,
      });
    }
  }

  return wins.slice(0, 4);
}
