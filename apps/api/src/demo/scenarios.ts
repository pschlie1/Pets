import type { Insight, ScenarioKey } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { REF } from '../db/seed';
import { mulberry32, randInt } from '../db/seed/rng';
import {
  evaluateCollarSignal,
  evaluateDevice,
  evaluateIntruder,
  evaluatePetMetric,
  evaluateSafetyEvent,
  type InsightListener,
} from '../engine/pipeline';

/**
 * The six PRD showcase scenarios. Each injector clears the seeded telemetry it
 * is about to overwrite, writes a crafted backdated sequence (plus environmental
 * context where the story needs it), then runs the real scoring pipeline — the
 * resulting insights are computed, not hardcoded. Demo reset restores seed state.
 *
 * Timing uses rolling 24h buckets relative to `now` (bucket 0 = last 24h),
 * matching how the engine aggregates daily values.
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface RawEvent {
  device_id: string;
  pet_id: string | null;
  device_type: string;
  event_type: string;
  occurred_at: number;
  payload: Record<string, unknown>;
}

function insertRaw(db: Db, householdId: string, events: RawEvent[]): void {
  const stmt = db.prepare(`
    INSERT INTO telemetry_events (id, household_id, device_id, pet_id, device_type, event_type, payload, schema_version, occurred_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const e of events) {
    const at = new Date(e.occurred_at).toISOString();
    stmt.run(uuid(), householdId, e.device_id, e.pet_id, e.device_type, e.event_type, JSON.stringify(e.payload), at, at);
  }
}

function clearWindow(db: Db, petId: string, eventType: string, now: number, days: number): void {
  db.prepare(`DELETE FROM telemetry_events WHERE pet_id = ? AND event_type = ? AND occurred_at >= ?`).run(
    petId,
    eventType,
    new Date(now - days * DAY).toISOString(),
  );
}

/** Device-scoped variant: a device outage silences the device, not the pet. */
function clearDeviceWindow(db: Db, deviceId: string, eventType: string, now: number, hours: number): void {
  db.prepare(`DELETE FROM telemetry_events WHERE device_id = ? AND event_type = ? AND occurred_at >= ?`).run(
    deviceId,
    eventType,
    new Date(now - hours * HOUR).toISOString(),
  );
}

function baselineFor(db: Db, petId: string, metric: string): { mean: number; stdev: number } {
  return db.prepare(`SELECT mean, stdev FROM pet_baselines WHERE pet_id = ? AND metric = ?`).get(petId, metric) as {
    mean: number;
    stdev: number;
  };
}

/** A timestamp inside rolling bucket `daysAgo` (2–22 hours back within the bucket). */
function inBucket(rng: () => number, now: number, daysAgo: number): number {
  return now - daysAgo * DAY - randInt(rng, 2, 22) * HOUR + randInt(rng, 0, 59) * 60_000;
}

type Injector = (db: Db, now: number, listener?: InsightListener) => Promise<Insight[]>;

/** S1 — Info: Lilo's water intake dips 5% below baseline on a cooler day. Logged only. */
const infoWaterDip: Injector = async (db, now, listener) => {
  const rng = mulberry32(101);
  const base = baselineFor(db, REF.lilo, 'water_intake_ml');
  clearWindow(db, REF.lilo, 'drinking_session', now, 3);
  const events: RawEvent[] = [];
  for (const daysAgo of [0, 1, 2]) {
    const visits = 7;
    for (let v = 0; v < visits; v++) {
      events.push({
        device_id: REF.fountain,
        pet_id: REF.lilo,
        device_type: 'fountain',
        event_type: 'drinking_session',
        occurred_at: inBucket(rng, now, daysAgo),
        payload: {
          duration_seconds: randInt(rng, 15, 40),
          estimated_volume_ml: Math.round((base.mean * 0.95) / visits),
          flow_rate_ml_s: 9.1,
        },
      });
    }
  }
  insertRaw(db, REF.householdId, events);
  const insight = await evaluatePetMetric(db, REF.lilo, 'water_intake_ml', now, listener, { persistInfo: true });
  return insight ? [insight] : [];
};

/** S2 — Monitor: the feeder's scheduled dispense drifts 3+ minutes late twice in a week. */
const monitorFeederDrift: Injector = async (db, now, listener) => {
  const events: RawEvent[] = [2, 5].map((daysAgo) => {
    const scheduled = now - daysAgo * DAY - 2 * HOUR;
    const drift = daysAgo === 2 ? 4 : 3;
    return {
      device_id: REF.feeder,
      pet_id: null,
      device_type: 'feeder',
      event_type: 'device_health_ping',
      occurred_at: scheduled + drift * 60_000,
      payload: {
        check: 'scheduled_dispense',
        scheduled_for: new Date(scheduled).toISOString(),
        dispensed_at: new Date(scheduled + drift * 60_000).toISOString(),
        drift_minutes: drift,
      },
    };
  });
  insertRaw(db, REF.householdId, events);
  const insight = await evaluateDevice(db, REF.feeder, now, listener);
  return insight ? [insight] : [];
};

/** S3 — Attention: both dogs' fountain visits drop together during a sub-10°F cold snap. */
const attentionColdSnap: Injector = async (db, now, listener) => {
  const rng = mulberry32(303);
  // Inject the cold snap into environmental context for today and yesterday.
  const envStmt = db.prepare(`
    INSERT INTO environmental_context (id, location_zip, date, temperature_low_f, temperature_high_f, conditions)
    VALUES (?, ?, ?, ?, ?, 'bitter cold snap')
    ON CONFLICT (location_zip, date) DO UPDATE SET
      temperature_low_f = excluded.temperature_low_f,
      temperature_high_f = excluded.temperature_high_f,
      conditions = excluded.conditions
  `);
  for (const daysAgo of [0, 1, 2]) {
    envStmt.run(uuid(), REF.zip, new Date(now - daysAgo * DAY).toISOString().slice(0, 10), -2, 8);
  }

  // Both dogs at ~45% of their usual intake across the whole 3-day evaluation
  // window — a shared, weather-shaped drop. Owning the full window keeps prior
  // scenario state from skewing either dog.
  for (const petId of [REF.meeko, REF.lilo]) {
    const base = baselineFor(db, petId, 'water_intake_ml');
    clearWindow(db, petId, 'drinking_session', now, 3);
    const events: RawEvent[] = [];
    for (const daysAgo of [0, 1, 2]) {
      const ratio = 0.45;
      const visits = 4;
      for (let v = 0; v < visits; v++) {
        events.push({
          device_id: REF.fountain,
          pet_id: petId,
          device_type: 'fountain',
          event_type: 'drinking_session',
          occurred_at: inBucket(rng, now, daysAgo),
          payload: {
            duration_seconds: randInt(rng, 10, 25),
            estimated_volume_ml: Math.round((base.mean * ratio) / visits),
            flow_rate_ml_s: 9.0,
          },
        });
      }
    }
    insertRaw(db, REF.householdId, events);
  }

  const insights: Insight[] = [];
  for (const petId of [REF.meeko, REF.lilo]) {
    const insight = await evaluatePetMetric(db, petId, 'water_intake_ml', now, listener);
    if (insight) insights.push(insight);
  }
  return insights;
};

/** S4 — Attention: the fountain's flow rate declines ~30% over five days. Filter near end of life. */
const attentionFountainFilter: Injector = async (db, now, listener) => {
  const rng = mulberry32(404);
  const events: RawEvent[] = [];
  // Heavy sampling of degraded flow in the last 24h pulls the bucket average
  // down ~30% against the 4-5 day-old readings.
  for (let i = 0; i < 40; i++) {
    events.push({
      device_id: REF.fountain,
      pet_id: rng() < 0.5 ? REF.meeko : REF.lilo,
      device_type: 'fountain',
      event_type: 'drinking_session',
      occurred_at: inBucket(rng, now, 0),
      payload: {
        duration_seconds: randInt(rng, 20, 55),
        estimated_volume_ml: randInt(rng, 60, 100),
        flow_rate_ml_s: Math.round((5.0 + rng() * 0.6) * 10) / 10,
      },
    });
  }
  insertRaw(db, REF.householdId, events);
  const insight = await evaluateDevice(db, REF.fountain, now, listener);
  return insight ? [insight] : [];
};

/** S5 — Urgent: Meeko's resting HR runs 15% above baseline for three days with shorter walks; Lilo stays normal. */
const urgentMeekoHeart: Injector = async (db, now, listener) => {
  const rng = mulberry32(505);
  const hrBase = baselineFor(db, REF.meeko, 'resting_heart_rate');
  const elevated = hrBase.mean * 1.15;

  clearWindow(db, REF.meeko, 'heart_rate_reading', now, 3);
  clearWindow(db, REF.meeko, 'activity_session', now, 3);

  const events: RawEvent[] = [];
  for (const daysAgo of [0, 1, 2]) {
    // Dense elevated resting readings own each bucket's average.
    for (let r = 0; r < 48; r++) {
      events.push({
        device_id: REF.meekoCollar,
        pet_id: REF.meeko,
        device_type: 'containment_collar',
        event_type: 'heart_rate_reading',
        occurred_at: inBucket(rng, now, daysAgo),
        payload: {
          bpm: Math.round(elevated + (rng() - 0.5) * 4),
          activity_state: 'resting',
          boundary_status: 'inside',
        },
      });
    }
    // Walks shorter and slower than usual over the same stretch.
    for (const hoursBack of [4, 14]) {
      events.push({
        device_id: REF.meekoCollar,
        pet_id: REF.meeko,
        device_type: 'containment_collar',
        event_type: 'activity_session',
        occurred_at: now - daysAgo * DAY - hoursBack * HOUR,
        payload: { duration_minutes: randInt(rng, 25, 26), distance_m: randInt(rng, 950, 1100), avg_pace: 'slow' },
      });
    }
  }
  insertRaw(db, REF.householdId, events);

  const insights: Insight[] = [];
  const hr = await evaluatePetMetric(db, REF.meeko, 'resting_heart_rate', now, listener);
  if (hr) insights.push(hr);
  const walks = await evaluatePetMetric(db, REF.meeko, 'walk_minutes', now, listener);
  if (walks) insights.push(walks);
  return insights;
};

/** S7 — Monitor: Meeko steps past the boundary but keeps moving and returns on his own. */
const breachSafeReturn: Injector = async (db, now, listener) => {
  // The breach must be the newest containment event while it lasts, and the
  // return the newest after it — clear the collar's recent check-ins.
  clearDeviceWindow(db, REF.meekoCollar, 'boundary_check', now, 2);

  const breachPayload = {
    status: 'breach',
    minutes_outside_zone: 0,
    motion_detected: true,
    last_known_position: { lat: 41.9209, lng: -87.65195 }, // just past the east fence line
  };
  const returnPayload = {
    status: 'return_to_zone',
    minutes_outside_zone: 7,
    motion_detected: true,
    position: { lat: 41.92078, lng: -87.65245 }, // back inside
  };
  insertRaw(db, REF.householdId, [
    {
      device_id: REF.meekoCollar,
      pet_id: REF.meeko,
      device_type: 'containment_collar',
      event_type: 'boundary_event',
      occurred_at: now - 9 * 60_000,
      payload: breachPayload,
    },
    {
      device_id: REF.meekoCollar,
      pet_id: REF.meeko,
      device_type: 'containment_collar',
      event_type: 'boundary_event',
      occurred_at: now - 2 * 60_000,
      payload: returnPayload,
    },
  ]);
  // Evaluate only the return: the story is one calm note, not an alarm that
  // gets walked back.
  const insight = await evaluateSafetyEvent(
    db,
    { household_id: REF.householdId, device_id: REF.meekoCollar, pet_id: REF.meeko, payload: returnPayload },
    now,
    listener,
  );
  return insight ? [insight] : [];
};

/** S8 — Attention: Lilo's collar goes silent; containment can no longer be verified. */
const collarSignalLost: Injector = async (db, now, listener) => {
  clearDeviceWindow(db, REF.liloCollar, 'boundary_check', now, 2);
  const insight = await evaluateCollarSignal(db, REF.liloCollar, now, listener);
  return insight ? [insight] : [];
};

/** S9 — Urgent: Meeko's collar battery drains to 12% — a containment safety gap. */
const collarBatteryCritical: Injector = async (db, now, listener) => {
  insertRaw(db, REF.householdId, [
    {
      device_id: REF.meekoCollar,
      pet_id: null,
      device_type: 'containment_collar',
      event_type: 'device_health_ping',
      occurred_at: now - 5 * 60_000, // strictly the newest health ping
      payload: { check: 'daily_status', battery_pct: 12, signal_strength: 4, firmware: '2.4.1' },
    },
  ]);
  const insight = await evaluateDevice(db, REF.meekoCollar, now, listener);
  return insight ? [insight] : [];
};

/** S6 — Emergency: Lilo's collar reports a boundary breach with extended no-motion outside the safe zone. */
const emergencyBoundaryBreach: Injector = async (db, now, listener) => {
  // Guarantee the breach is the newest containment event regardless of uptime.
  clearDeviceWindow(db, REF.liloCollar, 'boundary_check', now, 2);
  const payload = {
    status: 'breach',
    minutes_outside_zone: 22,
    motion_detected: false,
    last_known_position: { lat: 41.9214, lng: -87.6513 },
  };
  insertRaw(db, REF.householdId, [
    {
      device_id: REF.liloCollar,
      pet_id: REF.lilo,
      device_type: 'containment_collar',
      event_type: 'boundary_event',
      occurred_at: now - 22 * 60_000,
      payload,
    },
  ]);
  const insight = await evaluateSafetyEvent(
    db,
    { household_id: REF.householdId, device_id: REF.liloCollar, pet_id: REF.lilo, payload },
    now,
    listener,
  );
  return insight ? [insight] : [];
};

/** S10: the SmartDoor recognizes a raccoon at 2 AM, locks itself, and reports the save. */
const doorRaccoonLockout: Injector = async (db, now, listener) => {
  const at = now - 6 * HOUR; // overnight, a few hours ago
  const payload = { species_guess: 'raccoon', confidence: 0.93, action_taken: 'door_locked' };
  insertRaw(db, REF.householdId, [
    {
      device_id: REF.door,
      pet_id: null,
      device_type: 'smart_door',
      event_type: 'intruder_detection',
      occurred_at: at,
      payload,
    },
    {
      device_id: REF.door,
      pet_id: null,
      device_type: 'smart_door',
      event_type: 'door_status',
      occurred_at: at + 1000,
      payload: { locked: true, cause: 'intruder_detected' },
    },
  ]);
  const insight = await evaluateIntruder(
    db,
    { household_id: REF.householdId, device_id: REF.door, payload },
    now,
    listener,
  );
  return insight ? [insight] : [];
};

/** S11: Stitch's litter visits run ~2.5x baseline for three days — the early feline urinary signal. */
const litterVisitsSpike: Injector = async (db, now, listener) => {
  const rng = mulberry32(20260731);
  clearWindow(db, REF.stitch, 'litter_visit', now, 3);
  const events: RawEvent[] = [];
  // Baseline ≈ 3.5 visits/day; inject 8-9 across each of the last three rolling days.
  for (let day = 0; day < 3; day++) {
    const visits = randInt(rng, 8, 9);
    for (let i = 0; i < visits; i++) {
      events.push({
        device_id: REF.litterBox,
        pet_id: REF.stitch,
        device_type: 'litter_box',
        event_type: 'litter_visit',
        occurred_at: now - day * DAY - randInt(rng, 1, 23) * HOUR,
        payload: {
          duration_s: randInt(rng, 30, 90), // shorter, unproductive visits
          weight_lbs: 9.4,
          clump_detected: rng() < 0.4,
        },
      });
    }
  }
  insertRaw(db, REF.householdId, events);
  const insight = await evaluatePetMetric(db, REF.stitch, 'litter_visits_per_day', now, listener);
  return insight ? [insight] : [];
};

const INJECTORS: Record<ScenarioKey, Injector> = {
  info_water_dip: infoWaterDip,
  monitor_feeder_drift: monitorFeederDrift,
  attention_cold_snap: attentionColdSnap,
  attention_fountain_filter: attentionFountainFilter,
  urgent_meeko_heart: urgentMeekoHeart,
  breach_safe_return: breachSafeReturn,
  collar_signal_lost: collarSignalLost,
  collar_battery_critical: collarBatteryCritical,
  emergency_boundary_breach: emergencyBoundaryBreach,
  door_raccoon_lockout: doorRaccoonLockout,
  litter_visits_spike: litterVisitsSpike,
};

export async function triggerScenario(
  db: Db,
  key: ScenarioKey,
  now: number = Date.now(),
  listener?: InsightListener,
): Promise<Insight[]> {
  return INJECTORS[key](db, now, listener);
}
