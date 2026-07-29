import type { Db } from '../db/connection';
import { BASELINE_WINDOW_DAYS } from '../engine/baselines';
import { getContainmentStatus } from '../engine/containment';

/**
 * Demo-tier context assembly (PRD §7.2): the pet's profile, baselines, breed
 * profile, recent insights, sibling summary, and environmental context are
 * assembled server-side into one structured block before each agent call.
 *
 * PRODUCTION NOTE: the production tier replaces this with agent tool-calling
 * (get_pet_profile, get_pet_baseline, ...) so context always reflects live data.
 */

export interface PetContext {
  pet: {
    id: string;
    name: string;
    species: string;
    breedName: string | null;
    ageYears: number | null;
    weightLbs: number | null;
    sex: string | null;
  };
  breed: {
    restingHrLow: number;
    restingHrHigh: number;
    conditions: { condition: string; typical_onset: string; monitorable_today: boolean }[];
    isGenericFallback: boolean;
  } | null;
  baselines: { metric: string; mean: number; stdev: number; status: string; sampleCount: number }[];
  recentInsights: { urgency: string; insight_type: string; metric: string; summary: string; generated_at: string }[];
  sibling: { name: string; species: string } | null;
  environment: { date: string; lowF: number | null; highF: number | null; conditions: string | null } | null;
  containment: {
    state: 'protected' | 'breach' | 'signal_lost';
    minutesSinceCheckIn: number | null;
    batteryPct: number | null;
  } | null;
  dataWindowDays: number;
}

export function buildPetContext(db: Db, petId: string): PetContext | null {
  const pet = db
    .prepare(
      `SELECT p.id, p.household_id, p.name, p.species, p.breed_id, p.breed_reference_confidence,
              p.date_of_birth, p.weight_lbs, p.sex,
              b.breed_name, b.resting_hr_low, b.resting_hr_high, b.common_conditions, b.is_generic_fallback
       FROM pets p LEFT JOIN breed_profiles b ON b.id = p.breed_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(petId) as Record<string, unknown> | undefined;
  if (!pet) return null;

  const baselines = db
    .prepare(`SELECT metric, mean, stdev, status, sample_count FROM pet_baselines WHERE pet_id = ?`)
    .all(petId) as { metric: string; mean: number; stdev: number; status: string; sample_count: number }[];

  const recentInsights = db
    .prepare(
      `SELECT urgency, insight_type, metric, summary, generated_at FROM insights
       WHERE pet_id = ? AND acknowledged_status != 'dismissed'
       ORDER BY generated_at DESC LIMIT 8`,
    )
    .all(petId) as PetContext['recentInsights'];

  const sibling = db
    .prepare(
      `SELECT name, species FROM pets
       WHERE household_id = ? AND id != ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(pet.household_id as string, petId) as { name: string; species: string } | undefined;

  const env = db
    .prepare(
      `SELECT ec.date, ec.temperature_low_f, ec.temperature_high_f, ec.conditions
       FROM environmental_context ec
       JOIN households h ON h.location_zip = ec.location_zip
       WHERE h.id = ? ORDER BY ec.date DESC LIMIT 1`,
    )
    .get(pet.household_id as string) as
    | { date: string; temperature_low_f: number | null; temperature_high_f: number | null; conditions: string | null }
    | undefined;

  const dob = pet.date_of_birth as string | null;
  const ageYears = dob ? Math.floor((Date.now() - Date.parse(dob)) / (365.25 * 86_400_000)) : null;

  const containmentStatus = getContainmentStatus(db, pet.household_id as string);
  const petContainment = containmentStatus.pets.find((p) => p.pet_id === petId);

  return {
    pet: {
      id: pet.id as string,
      name: pet.name as string,
      species: pet.species as string,
      breedName: (pet.breed_name as string | null) ?? null,
      ageYears,
      weightLbs: pet.weight_lbs as number | null,
      sex: pet.sex as string | null,
    },
    breed: pet.resting_hr_low
      ? {
          restingHrLow: pet.resting_hr_low as number,
          restingHrHigh: pet.resting_hr_high as number,
          conditions: JSON.parse((pet.common_conditions as string) ?? '[]'),
          isGenericFallback: Boolean(pet.is_generic_fallback),
        }
      : null,
    baselines: baselines.map((b) => ({
      metric: b.metric,
      mean: b.mean,
      stdev: b.stdev,
      status: b.status,
      sampleCount: b.sample_count,
    })),
    recentInsights,
    sibling: sibling ?? null,
    environment: env
      ? { date: env.date, lowF: env.temperature_low_f, highF: env.temperature_high_f, conditions: env.conditions }
      : null,
    containment: petContainment
      ? {
          state: petContainment.containment_state,
          minutesSinceCheckIn: petContainment.minutes_since_check_in,
          batteryPct: petContainment.battery_pct,
        }
      : null,
    dataWindowDays: BASELINE_WINDOW_DAYS,
  };
}

/** Renders the context as a compact text block for the agent prompts. */
export function renderContext(ctx: PetContext): string {
  const lines: string[] = [
    `Pet: ${ctx.pet.name} — ${ctx.pet.breedName ?? `${ctx.pet.species} (breed not specified)`}, ` +
      `${ctx.pet.ageYears !== null ? `${ctx.pet.ageYears} years old` : 'age unknown'}, ` +
      `${ctx.pet.weightLbs ?? '?'} lbs, ${ctx.pet.sex ?? 'sex unknown'}`,
  ];
  if (ctx.breed) {
    lines.push(
      `Breed reference: resting HR ${ctx.breed.restingHrLow}-${ctx.breed.restingHrHigh} bpm` +
        (ctx.breed.isGenericFallback ? ' (species-generic fallback, low confidence)' : ''),
    );
    if (ctx.breed.conditions.length > 0) {
      lines.push(
        `Known breed predispositions: ${ctx.breed.conditions.map((c) => `${c.condition} (${c.typical_onset})`).join('; ')}`,
      );
    }
  }
  lines.push(`Personal baselines (rolling ${ctx.dataWindowDays}-day window):`);
  for (const b of ctx.baselines) {
    lines.push(
      `  - ${b.metric}: mean ${b.mean}, stdev ${b.stdev}, ${b.sampleCount} samples` +
        (b.status === 'insufficient_data' ? ' [INSUFFICIENT DATA — do not draw conclusions]' : ''),
    );
  }
  if (ctx.recentInsights.length > 0) {
    lines.push('Recent insights:');
    for (const i of ctx.recentInsights) {
      lines.push(`  - [${i.urgency}] ${i.metric}: ${i.summary}`);
    }
  } else {
    lines.push('Recent insights: none — everything reads normal.');
  }
  lines.push(
    ctx.sibling
      ? `Household sibling: ${ctx.sibling.name} (${ctx.sibling.species})`
      : 'No other pets in the household.',
  );
  if (ctx.environment) {
    lines.push(
      `Latest local weather (${ctx.environment.date}): ${ctx.environment.lowF}-${ctx.environment.highF}°F, ${ctx.environment.conditions ?? ''}`,
    );
  }
  if (ctx.containment) {
    const c = ctx.containment;
    const stateText =
      c.state === 'protected'
        ? `inside the safe zone, last collar check-in ${c.minutesSinceCheckIn ?? '?'} minutes ago`
        : c.state === 'breach'
          ? 'OUTSIDE the safe zone right now'
          : `collar signal lost — no check-in for ${c.minutesSinceCheckIn ?? '?'} minutes, containment unverified`;
    lines.push(`Containment: ${stateText}${c.batteryPct !== null ? `; collar battery ${c.batteryPct}%` : ''}`);
  }
  return lines.join('\n');
}
