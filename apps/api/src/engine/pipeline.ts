import type { Insight, InsightType, Urgency } from '@connected-care/shared';
import { SIGNAL_LOSS_MIN, urgencyRank } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { dailyMetricSeries, type PetMetric } from './aggregates';
import { scoreEquipment, scoreMetric, scoreSafetyEvent, type ScoringResult } from './scoring';
import { narrateInsight, type NarratorInput } from '../agents/narrator';

/**
 * Orchestrates: gather inputs → score → narrate → persist (with dedupe) → notify.
 *
 * PRODUCTION NOTE: production consumes the telemetry stream asynchronously so a
 * slow scoring run never blocks ingestion. The demo runs scoring synchronously
 * after each POST for instant, deterministic feedback.
 */

const DAY = 86_400_000;

export type InsightListener = (householdId: string, insight: Insight) => void;

interface PetRow {
  id: string;
  household_id: string;
  name: string;
  species: string;
  breed_id: string | null;
  date_of_birth: string | null;
}

interface BreedRow {
  resting_hr_low: number;
  resting_hr_high: number;
  common_conditions: string;
  is_generic_fallback: number;
}

function getPet(db: Db, petId: string): PetRow | undefined {
  return db.prepare(`SELECT * FROM pets WHERE id = ? AND deleted_at IS NULL`).get(petId) as PetRow | undefined;
}

function ageYears(pet: PetRow, now: number): number | null {
  return pet.date_of_birth ? Math.floor((now - Date.parse(pet.date_of_birth)) / (365.25 * DAY)) : null;
}

/**
 * Breed risk weighting: a metric tied to a documented breed predisposition at
 * the pet's current age scores higher. The CKCS cardiac case is the flagship:
 * mitral valve disease risk rises sharply from middle age.
 */
function breedRiskWeight(db: Db, pet: PetRow, metric: string, now: number): { weight: number; context: string | null } {
  if (!pet.breed_id) return { weight: 1, context: null };
  const breed = db
    .prepare(`SELECT breed_name, common_conditions FROM breed_profiles WHERE id = ?`)
    .get(pet.breed_id) as { breed_name: string | null; common_conditions: string } | undefined;
  if (!breed) return { weight: 1, context: null };
  const conditions = JSON.parse(breed.common_conditions) as { condition: string }[];
  const age = ageYears(pet, now) ?? 0;

  if (metric === 'resting_heart_rate' && age >= 5 && conditions.some((c) => /mitral valve/i.test(c.condition))) {
    return {
      weight: 1.6,
      context: `Given the breed's well-documented mitral valve risk at this age, this trend deserves attention.`,
    };
  }
  if (metric === 'food_intake_g' && conditions.some((c) => /obesity/i.test(c.condition))) {
    return { weight: 1.2, context: `The breed has a known obesity tendency, so intake trends matter.` };
  }
  return { weight: 1, context: null };
}

/** Recent value + persistence for one metric: average of the trailing window, and how many days deviated. */
function recentReading(
  db: Db,
  petId: string,
  metric: PetMetric,
  baseline: { mean: number; stdev: number },
  now: number,
  windowDays = 3,
): { value: number; durationDays: number } | null {
  const series = dailyMetricSeries(db, petId, metric, new Date(now - windowDays * DAY).toISOString(), now);
  const values = [...series.values()];
  if (values.length === 0) return null;
  const value = values.reduce((a, b) => a + b, 0) / values.length;
  const dir = Math.sign(value - baseline.mean);
  const durationDays = values.filter(
    (v) => Math.sign(v - baseline.mean) === dir && Math.abs(v - baseline.mean) > baseline.stdev,
  ).length;
  return { value, durationDays: Math.max(durationDays, 1) };
}

/** Weather explains a deviation when it plausibly drives the metric in the observed direction. */
function environmentExplains(
  db: Db,
  householdId: string,
  metric: string,
  deviationDirection: number,
  now: number,
): { explains: boolean; note: string | null } {
  const env = db
    .prepare(
      `SELECT ec.temperature_low_f AS low, ec.temperature_high_f AS high, ec.conditions
       FROM environmental_context ec JOIN households h ON h.location_zip = ec.location_zip
       WHERE h.id = ? AND ec.date <= ? ORDER BY ec.date DESC LIMIT 1`,
    )
    .get(householdId, new Date(now).toISOString().slice(0, 10)) as
    | { low: number | null; high: number | null; conditions: string | null }
    | undefined;
  if (!env || env.high === null) return { explains: false, note: null };

  const veryCold = env.high < 20 || (env.low !== null && env.low < 10);
  const veryHot = env.high >= 92;
  if (metric === 'water_intake_ml' && deviationDirection < 0 && veryCold) {
    return {
      explains: true,
      note: `A cold snap (${env.low}–${env.high}°F) explains lower fountain visits across the household — though cold-weather dehydration is still worth a gentle watch.`,
    };
  }
  if (metric === 'walk_minutes' && deviationDirection < 0 && (veryCold || veryHot)) {
    return { explains: true, note: `Extreme temperatures (${env.low}–${env.high}°F) explain shorter walks.` };
  }
  if (metric === 'water_intake_ml' && deviationDirection > 0 && veryHot) {
    return { explains: true, note: `Hot weather (${env.high}°F) explains extra drinking.` };
  }
  return { explains: false, note: null };
}

async function persistInsight(
  db: Db,
  opts: {
    householdId: string;
    petId: string | null;
    deviceId: string | null;
    insightType: InsightType;
    metric: string;
    result: ScoringResult;
    narratorInput: NarratorInput;
    now: number;
    routeToAssociate?: boolean;
  },
  listener?: InsightListener,
): Promise<Insight | null> {
  const day = new Date(opts.now).toISOString().slice(0, 10);
  const dedupeKey = `${opts.petId ?? opts.deviceId}:${opts.metric}:${day}`;

  const existing = db.prepare(`SELECT id, urgency FROM insights WHERE dedupe_key = ?`).get(dedupeKey) as
    | { id: string; urgency: Urgency }
    | undefined;
  if (existing && urgencyRank(existing.urgency) >= urgencyRank(opts.result.urgency)) return null;

  const narration = await narrateInsight(opts.narratorInput);
  const id = existing?.id ?? uuid();
  const generatedAt = new Date(opts.now).toISOString();
  const routed = opts.routeToAssociate ? 1 : 0;

  if (existing) {
    // Same subject+metric+day at higher severity: upgrade in place rather than re-alerting.
    db.prepare(
      `UPDATE insights SET severity_score = ?, urgency = ?, summary = ?, recommended_action = ?,
         generated_at = ?, acknowledged_status = 'unseen', routed_to_associate = ?, narration_mode = ? WHERE id = ?`,
    ).run(
      opts.result.severityScore,
      opts.result.urgency,
      narration.summary,
      narration.recommendedAction,
      generatedAt,
      routed,
      narration.mode,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO insights (id, household_id, pet_id, device_id, insight_type, metric, severity_score, urgency,
         summary, recommended_action, generated_at, routed_to_associate, narration_mode, dedupe_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      opts.householdId,
      opts.petId,
      opts.deviceId,
      opts.insightType,
      opts.metric,
      opts.result.severityScore,
      opts.result.urgency,
      narration.summary,
      narration.recommendedAction,
      generatedAt,
      routed,
      narration.mode,
      dedupeKey,
    );
  }

  const insight = db.prepare(`SELECT * FROM insights WHERE id = ?`).get(id) as unknown as Insight;
  listener?.(opts.householdId, insight);
  return insight;
}

/** Evaluates one pet metric end-to-end. Returns the created/upgraded insight, if any. */
export async function evaluatePetMetric(
  db: Db,
  petId: string,
  metric: PetMetric,
  now: number = Date.now(),
  listener?: InsightListener,
  opts?: { persistInfo?: boolean },
): Promise<Insight | null> {
  const pet = getPet(db, petId);
  if (!pet) return null;

  const baseline = db
    .prepare(`SELECT mean, stdev, status FROM pet_baselines WHERE pet_id = ? AND metric = ?`)
    .get(petId, metric) as { mean: number; stdev: number; status: 'established' | 'insufficient_data' } | undefined;
  if (!baseline) return null;

  const reading = recentReading(db, petId, metric, baseline, now);
  if (!reading) return null;

  const breed = pet.breed_id
    ? (db
        .prepare(
          `SELECT resting_hr_low, resting_hr_high, common_conditions, is_generic_fallback FROM breed_profiles WHERE id = ?`,
        )
        .get(pet.breed_id) as BreedRow | undefined)
    : undefined;

  // Peer comparison only against a same-species sibling — a cat and a dog are
  // not a valid control group for each other's physiology.
  const sibling = db
    .prepare(
      `SELECT id, name FROM pets WHERE household_id = ? AND id != ? AND species = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(pet.household_id, petId, pet.species) as { id: string; name: string } | undefined;

  let siblingDeviates: boolean | null = null;
  if (sibling) {
    const sibBaseline = db
      .prepare(`SELECT mean, stdev, status FROM pet_baselines WHERE pet_id = ? AND metric = ?`)
      .get(sibling.id, metric) as { mean: number; stdev: number; status: string } | undefined;
    if (sibBaseline && sibBaseline.status === 'established') {
      const sibReading = recentReading(db, sibling.id, metric, sibBaseline, now);
      siblingDeviates = sibReading
        ? Math.abs(sibReading.value - sibBaseline.mean) > 1.5 * sibBaseline.stdev
        : null;
    }
  }

  const deviationDir = Math.sign(reading.value - baseline.mean);
  const env = environmentExplains(db, pet.household_id, metric, deviationDir, now);
  const risk = breedRiskWeight(db, pet, metric, now);

  const result = scoreMetric({
    metric,
    value: reading.value,
    baseline,
    durationDays: reading.durationDays,
    breedRange:
      breed && metric === 'resting_heart_rate'
        ? { low: breed.resting_hr_low, high: breed.resting_hr_high, isGenericFallback: Boolean(breed.is_generic_fallback) }
        : null,
    sibling: siblingDeviates === null ? null : { deviates: siblingDeviates },
    environment: { explainsDeviation: env.explains },
    breedRiskWeight: risk.weight,
  });

  // Nothing noteworthy and nothing suppressed-worthy → no insight row at all.
  // (persistInfo forces an info row — used when a reading is worth logging quietly.)
  if (result.urgency === 'info' && Math.abs(result.personalDeviation) < 0.5 && !opts?.persistInfo) return null;

  const deviationPct = baseline.mean !== 0 ? ((reading.value - baseline.mean) / baseline.mean) * 100 : 0;
  return persistInsight(
    db,
    {
      householdId: pet.household_id,
      petId,
      deviceId: null,
      insightType: 'pet_health',
      metric,
      result,
      now,
      narratorInput: {
        insightType: 'pet_health',
        urgency: result.urgency,
        metric,
        petName: pet.name,
        deviceLabel: null,
        currentValue: Math.round(reading.value * 10) / 10,
        baselineMean: baseline.mean,
        deviationPct: Math.round(deviationPct * 10) / 10,
        durationDays: reading.durationDays,
        factors: result.factors,
        breedContext: risk.context,
        siblingName: sibling?.name ?? null,
        siblingDeviated: siblingDeviates,
        environmentNote: env.note,
      },
    },
    listener,
  );
}

/** Equipment checks for one device: feeder schedule drift, fountain flow decline, collar battery. */
export async function evaluateDevice(
  db: Db,
  deviceId: string,
  now: number = Date.now(),
  listener?: InsightListener,
): Promise<Insight | null> {
  const device = db
    .prepare(`SELECT id, household_id, device_type, model FROM devices WHERE id = ? AND deleted_at IS NULL`)
    .get(deviceId) as { id: string; household_id: string; device_type: string; model: string | null } | undefined;
  if (!device) return null;

  const label = device.model ?? device.device_type.replace(/_/g, ' ');

  if (device.device_type === 'feeder') {
    const drifts = db
      .prepare(
        `SELECT payload FROM telemetry_events
         WHERE device_id = ? AND event_type = 'device_health_ping' AND occurred_at >= ?`,
      )
      .all(deviceId, new Date(now - 7 * DAY).toISOString()) as { payload: string }[];
    const lateCount = drifts.filter((r) => {
      const p = JSON.parse(r.payload) as { check?: string; drift_minutes?: number };
      return p.check === 'scheduled_dispense' && (p.drift_minutes ?? 0) >= 3;
    }).length;
    if (lateCount >= 2) {
      const result = scoreEquipment({ metric: 'feeder_schedule_drift_min', occurrences: lateCount });
      return persistInsight(
        db,
        {
          householdId: device.household_id,
          petId: null,
          deviceId,
          insightType: 'equipment',
          metric: 'feeder_schedule_drift_min',
          result,
          now,
          narratorInput: {
            insightType: 'equipment',
            urgency: result.urgency,
            metric: 'feeder_schedule_drift_min',
            petName: null,
            deviceLabel: label,
            currentValue: lateCount,
            baselineMean: 0,
            deviationPct: null,
            durationDays: 7,
            factors: result.factors,
            breedContext: null,
            siblingName: null,
            siblingDeviated: null,
            environmentNote: null,
          },
        },
        listener,
      );
    }
  }

  if (device.device_type === 'fountain') {
    const rows = db
      .prepare(
        `SELECT payload, occurred_at FROM telemetry_events
         WHERE device_id = ? AND event_type = 'drinking_session' AND occurred_at >= ? ORDER BY occurred_at`,
      )
      .all(deviceId, new Date(now - 5 * DAY).toISOString()) as { payload: string; occurred_at: string }[];
    const byDay = new Map<number, number[]>();
    for (const r of rows) {
      const p = JSON.parse(r.payload) as { flow_rate_ml_s?: number };
      if (typeof p.flow_rate_ml_s !== 'number') continue;
      const day = Math.max(Math.floor((now - Date.parse(r.occurred_at)) / DAY), 0);
      byDay.set(day, [...(byDay.get(day) ?? []), p.flow_rate_ml_s]);
    }
    // Oldest rolling bucket first, most recent last.
    const days = [...byDay.entries()].sort(([a], [b]) => b - a);
    if (days.length >= 3) {
      const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const first = avg(days[0][1]);
      const last = avg(days[days.length - 1][1]);
      if (first > 0 && last / first <= 0.9) {
        const result = scoreEquipment({ metric: 'fountain_flow_rate', changeRatio: last / first });
        return persistInsight(
          db,
          {
            householdId: device.household_id,
            petId: null,
            deviceId,
            insightType: 'equipment',
            metric: 'fountain_flow_rate',
            result,
            now,
            narratorInput: {
              insightType: 'equipment',
              urgency: result.urgency,
              metric: 'fountain_flow_rate',
              petName: null,
              deviceLabel: label,
              currentValue: Math.round(last * 10) / 10,
              baselineMean: Math.round(first * 10) / 10,
              deviationPct: Math.round((last / first - 1) * 100),
              durationDays: days.length,
              factors: result.factors,
              breedContext: null,
              siblingName: null,
              siblingDeviated: null,
              environmentNote: null,
            },
          },
          listener,
        );
      }
    }
  }

  if (device.device_type === 'containment_collar') {
    const latest = db
      .prepare(
        `SELECT payload FROM telemetry_events
         WHERE device_id = ? AND event_type = 'device_health_ping' ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get(deviceId) as { payload: string } | undefined;
    if (latest) {
      const p = JSON.parse(latest.payload) as { battery_pct?: number };
      if (typeof p.battery_pct === 'number' && p.battery_pct <= 20) {
        const result = scoreEquipment({ metric: 'collar_battery_pct', threatensSafety: true });
        db.prepare(`UPDATE devices SET status = 'low_battery' WHERE id = ?`).run(deviceId);
        return persistInsight(
          db,
          {
            householdId: device.household_id,
            petId: null,
            deviceId,
            insightType: 'equipment',
            metric: 'collar_battery_pct',
            result,
            now,
            narratorInput: {
              insightType: 'equipment',
              urgency: result.urgency,
              metric: 'collar_battery_pct',
              petName: null,
              deviceLabel: label,
              currentValue: p.battery_pct,
              baselineMean: 100,
              deviationPct: null,
              durationDays: 1,
              factors: result.factors,
              breedContext: null,
              siblingName: null,
              siblingDeviated: null,
              environmentNote: null,
            },
          },
          listener,
        );
      }
    }
  }

  return null;
}

/** Safety evaluation for a boundary event just ingested. */
export async function evaluateSafetyEvent(
  db: Db,
  event: { household_id: string; device_id: string; pet_id: string | null; payload: Record<string, unknown> },
  now: number = Date.now(),
  listener?: InsightListener,
): Promise<Insight | null> {
  const p = event.payload as { status?: string; minutes_outside_zone?: number; motion_detected?: boolean };
  if (p.status !== 'breach' && p.status !== 'return_to_zone') return null;

  const pet = event.pet_id ? getPet(db, event.pet_id) : undefined;
  // A return_to_zone scores as a calm monitor note. If a same-day breach
  // insight already exists for this pet, persistInsight's dedupe refuses the
  // downgrade — the louder insight stands, which is the correct behavior.
  const result = scoreSafetyEvent(
    p.status === 'return_to_zone'
      ? {
          eventType: 'breach_safe_return',
          minutesOutsideZone: p.minutes_outside_zone ?? 0,
          motionDetected: p.motion_detected ?? true,
        }
      : {
          eventType: 'boundary_breach',
          minutesOutsideZone: p.minutes_outside_zone ?? 0,
          motionDetected: p.motion_detected ?? true,
        },
  );

  return persistInsight(
    db,
    {
      householdId: event.household_id,
      petId: event.pet_id,
      deviceId: event.device_id,
      insightType: 'pet_safety',
      metric: 'boundary_safety',
      result,
      now,
      routeToAssociate: result.urgency === 'emergency',
      narratorInput: {
        insightType: 'pet_safety',
        urgency: result.urgency,
        metric: 'boundary_safety',
        petName: pet?.name ?? null,
        deviceLabel: 'Boundary Plus GPS collar',
        currentValue: p.minutes_outside_zone ?? null,
        baselineMean: null,
        deviationPct: null,
        durationDays: 1,
        factors: result.factors,
        breedContext: null,
        siblingName: null,
        siblingDeviated: null,
        environmentNote: null,
      },
    },
    listener,
  );
}

/**
 * Signal-loss detection. Loss is the ABSENCE of events, so nothing flows
 * through evaluateAfterEvent — the demo scenario calls this directly.
 * PRODUCTION NOTE: production runs this as a watchdog job over each collar's
 * MAX(occurred_at), not on demand.
 */
export async function evaluateCollarSignal(
  db: Db,
  deviceId: string,
  now: number = Date.now(),
  listener?: InsightListener,
): Promise<Insight | null> {
  const device = db
    .prepare(`SELECT id, household_id, model FROM devices WHERE id = ? AND deleted_at IS NULL`)
    .get(deviceId) as { id: string; household_id: string; model: string | null } | undefined;
  if (!device) return null;

  const link = db
    .prepare(`SELECT pet_id FROM device_pet_links WHERE device_id = ? AND unlinked_at IS NULL LIMIT 1`)
    .get(deviceId) as { pet_id: string } | undefined;
  const pet = link ? getPet(db, link.pet_id) : undefined;

  const latest = db
    .prepare(
      `SELECT MAX(occurred_at) AS at FROM telemetry_events WHERE device_id = ? AND event_type = 'boundary_check'`,
    )
    .get(deviceId) as { at: string | null };
  const minutesSince = latest.at ? Math.round((now - Date.parse(latest.at)) / 60_000) : Infinity;
  if (minutesSince < SIGNAL_LOSS_MIN) return null;

  db.prepare(`UPDATE devices SET status = 'offline' WHERE id = ?`).run(deviceId);

  const result = scoreSafetyEvent({ eventType: 'signal_lost', minutesSinceCheckIn: minutesSince });
  return persistInsight(
    db,
    {
      householdId: device.household_id,
      petId: pet?.id ?? null,
      deviceId,
      insightType: 'pet_safety',
      metric: 'containment_signal',
      result,
      now,
      narratorInput: {
        insightType: 'pet_safety',
        urgency: result.urgency,
        metric: 'containment_signal',
        petName: pet?.name ?? null,
        deviceLabel: device.model ?? 'Containment collar',
        currentValue: Number.isFinite(minutesSince) ? minutesSince : null,
        baselineMean: null,
        deviationPct: null,
        durationDays: 1,
        factors: result.factors,
        breedContext: null,
        siblingName: null,
        siblingDeviated: null,
        environmentNote: null,
      },
    },
    listener,
  );
}

const EVENT_METRIC: Record<string, PetMetric> = {
  heart_rate_reading: 'resting_heart_rate',
  activity_session: 'walk_minutes',
  drinking_session: 'water_intake_ml',
  feeding_session: 'food_intake_g',
  sleep_session: 'sleep_hours',
};

/** Entry point after every telemetry POST: routes the event to the right evaluation. */
export async function evaluateAfterEvent(
  db: Db,
  event: {
    household_id: string;
    device_id: string;
    pet_id: string | null;
    event_type: string;
    payload: Record<string, unknown>;
  },
  now: number = Date.now(),
  listener?: InsightListener,
): Promise<Insight[]> {
  const insights: (Insight | null)[] = [];

  if (event.event_type === 'boundary_event') {
    insights.push(await evaluateSafetyEvent(db, event, now, listener));
  } else if (event.event_type === 'boundary_check') {
    // A check-in arriving for an offline collar means the signal is back.
    db.prepare(`UPDATE devices SET status = 'active' WHERE id = ? AND status = 'offline'`).run(event.device_id);
  } else if (event.event_type === 'device_health_ping') {
    insights.push(await evaluateDevice(db, event.device_id, now, listener));
  } else if (event.pet_id && EVENT_METRIC[event.event_type]) {
    insights.push(await evaluatePetMetric(db, event.pet_id, EVENT_METRIC[event.event_type], now, listener));
  }

  return insights.filter((i): i is Insight => i !== null);
}
