import type { Db } from '../db/connection';
import { dailyMetricSeries, meanStdev, PET_METRICS } from './aggregates';

const DAY = 86_400_000;
export const BASELINE_WINDOW_DAYS = 14;
export const MIN_BASELINE_DAYS = 7;

/**
 * Recomputes the rolling 14-day personal baseline for every metric of one pet.
 * Fewer than 7 distinct days of readings → status 'insufficient_data', which
 * downstream scoring treats as suppressed / low confidence.
 *
 * PRODUCTION NOTE: runs nightly per the PRD; the demo recomputes at seed time
 * and after scenario injections so baselines always reflect current data.
 */
export function recomputeBaselines(db: Db, petId: string, now: number = Date.now()): void {
  const sinceIso = new Date(now - BASELINE_WINDOW_DAYS * DAY).toISOString();
  const stmt = db.prepare(`
    INSERT INTO pet_baselines (pet_id, metric, mean, stdev, window_days, sample_count, status, last_computed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (pet_id, metric) DO UPDATE SET
      mean = excluded.mean, stdev = excluded.stdev, sample_count = excluded.sample_count,
      status = excluded.status, last_computed = excluded.last_computed
  `);

  for (const metric of PET_METRICS) {
    const series = dailyMetricSeries(db, petId, metric, sinceIso, now);
    const values = [...series.values()];
    if (values.length === 0) continue;
    const { mean, stdev } = meanStdev(values);
    const status = series.size >= MIN_BASELINE_DAYS ? 'established' : 'insufficient_data';
    stmt.run(
      petId,
      metric,
      Math.round(mean * 100) / 100,
      // Floor stdev so a suspiciously flat series can't make tiny deviations look like 10σ events.
      Math.max(Math.round(stdev * 100) / 100, mean * 0.02),
      BASELINE_WINDOW_DAYS,
      values.length,
      status,
      new Date(now).toISOString(),
    );
  }
}
