import {
  urgencyRank,
  type Insight,
  type Urgency,
  type VetReport,
  type VetReportMetricSeries,
  type VetShare,
} from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { dailyMetricSeries, PET_METRICS } from '../engine/aggregates';
import { BASELINE_WINDOW_DAYS } from '../engine/baselines';
import { getContainmentStatus } from '../engine/containment';
import { summarizeForVet } from '../agents/vetSummary';

const DAY = 86_400_000;

/**
 * Assembles the live vet report for one pet. Reports are generated at request
 * time and never persisted — only shares (vet_shares rows) persist, and a
 * share records insight ids, not a content snapshot.
 */

export function parseShare(row: Record<string, unknown>): VetShare {
  return { ...(row as unknown as VetShare), insight_ids: JSON.parse((row.insight_ids as string) ?? '[]') };
}

export function activeInsights(db: Db, petId: string): Insight[] {
  const rows = db
    .prepare(
      `SELECT * FROM insights WHERE pet_id = ? AND acknowledged_status != 'dismissed' ORDER BY generated_at DESC LIMIT 20`,
    )
    .all(petId) as unknown as Insight[];
  return rows.sort(
    (a, b) =>
      urgencyRank(b.urgency as Urgency) - urgencyRank(a.urgency as Urgency) ||
      b.generated_at.localeCompare(a.generated_at),
  );
}

export async function buildVetReport(db: Db, petId: string, now: number = Date.now()): Promise<VetReport | null> {
  const pet = db
    .prepare(
      `SELECT p.*, b.breed_name, b.size_class, b.resting_hr_low, b.resting_hr_high, b.common_conditions, b.is_generic_fallback
       FROM pets p LEFT JOIN breed_profiles b ON b.id = p.breed_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(petId) as Record<string, unknown> | undefined;
  if (!pet) return null;

  const householdId = pet.household_id as string;
  const dob = pet.date_of_birth as string | null;

  // All five metrics through the same aggregation the trends UI uses.
  const sinceIso = new Date(now - BASELINE_WINDOW_DAYS * DAY).toISOString();
  const metrics: VetReportMetricSeries[] = PET_METRICS.map((metric) => {
    const series = dailyMetricSeries(db, petId, metric, sinceIso, now);
    const baseline = db
      .prepare(`SELECT mean, stdev, status FROM pet_baselines WHERE pet_id = ? AND metric = ?`)
      .get(petId, metric) as { mean: number; stdev: number; status: string } | undefined;
    return {
      metric,
      points: [...series.entries()]
        .sort(([a], [b]) => b - a)
        .map(([days_ago, value]) => ({ days_ago, value: Math.round(value * 10) / 10 })),
      baseline: baseline ?? null,
    };
  }).filter((m) => m.points.length > 0 || m.baseline !== null);

  const summary = await summarizeForVet(db, petId, metrics);
  if (!summary) return null;

  const baselines = db.prepare(`SELECT * FROM pet_baselines WHERE pet_id = ?`).all(petId) as VetReport['baselines'];

  const containmentStatus = getContainmentStatus(db, householdId, now);
  const petContainment = containmentStatus.pets.find((p) => p.pet_id === petId);

  const env = db
    .prepare(
      `SELECT ec.date, ec.temperature_low_f AS low_f, ec.temperature_high_f AS high_f, ec.conditions
       FROM environmental_context ec JOIN households h ON h.location_zip = ec.location_zip
       WHERE h.id = ? ORDER BY ec.date DESC LIMIT 1`,
    )
    .get(householdId) as VetReport['environment'] | undefined;

  const shares = (
    db.prepare(`SELECT * FROM vet_shares WHERE pet_id = ? ORDER BY shared_at DESC`).all(petId) as Record<
      string,
      unknown
    >[]
  ).map(parseShare);

  return {
    report_id: uuid(),
    generated_at: new Date(now).toISOString(),
    window_days: BASELINE_WINDOW_DAYS,
    pet: {
      id: pet.id as string,
      name: pet.name as string,
      species: pet.species as VetReport['pet']['species'],
      breed_name: (pet.breed_name as string | null) ?? null,
      breed_reference_confidence: pet.breed_reference_confidence as 'high' | 'low',
      date_of_birth: dob,
      age_years: dob ? Math.floor((now - Date.parse(dob)) / (365.25 * DAY)) : null,
      weight_lbs: pet.weight_lbs as number | null,
      sex: pet.sex as string | null,
    },
    breed: pet.resting_hr_low
      ? {
          breed_name: (pet.breed_name as string | null) ?? null,
          size_class: pet.size_class as string,
          resting_hr_low: pet.resting_hr_low as number,
          resting_hr_high: pet.resting_hr_high as number,
          common_conditions: JSON.parse((pet.common_conditions as string) ?? '[]'),
          is_generic_fallback: Boolean(pet.is_generic_fallback),
        }
      : null,
    summary,
    baselines,
    metrics,
    active_insights: activeInsights(db, petId),
    containment: petContainment
      ? {
          state: petContainment.containment_state,
          minutes_since_check_in: petContainment.minutes_since_check_in,
          battery_pct: petContainment.battery_pct,
        }
      : null,
    environment: env ?? null,
    shares,
  };
}
