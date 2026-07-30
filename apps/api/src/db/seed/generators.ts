import {
  BOUNDARY_CHECK_INTERVAL_MIN,
  pointInPolygon,
  type LatLng,
  type YardGeometry,
} from '@connected-care/shared';
import { gaussian, randInt, type Rng } from './rng';

export interface GeneratedEvent {
  device_id: string;
  pet_id: string | null;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function iso(t: number): string {
  return new Date(t).toISOString();
}

/** Circadian offset for resting heart rate: lower overnight, mild peaks after walk windows. */
function circadian(hourOfDay: number): number {
  if (hourOfDay >= 22 || hourOfDay < 6) return -6;
  if (hourOfDay === 7 || hourOfDay === 8 || hourOfDay === 18 || hourOfDay === 19) return 5;
  return 0;
}

/**
 * Resting heart-rate readings every 30 minutes for `days` days ending at `endMs`.
 * A collar reading: bpm + activity state + boundary status.
 */
export function heartRateSeries(
  rng: Rng,
  opts: { deviceId: string; petId: string; mean: number; stdev: number; days: number; endMs: number },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  for (let t = start; t < opts.endMs; t += 30 * 60_000) {
    const hour = new Date(t).getUTCHours();
    const bpm = Math.round(opts.mean + circadian(hour) + gaussian(rng, 0, opts.stdev));
    events.push({
      device_id: opts.deviceId,
      pet_id: opts.petId,
      event_type: 'heart_rate_reading',
      occurred_at: iso(t),
      payload: {
        bpm,
        activity_state: hour >= 22 || hour < 6 ? 'resting' : rng() < 0.3 ? 'active' : 'resting',
        boundary_status: 'inside',
      },
    });
  }
  return events;
}

/** Two walks per day (morning + evening) with duration and distance. */
export function activitySeries(
  rng: Rng,
  opts: { deviceId: string; petId: string; days: number; endMs: number; baseMinutes?: number },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const base = opts.baseMinutes ?? 28;
  const start = opts.endMs - opts.days * DAY;
  for (let d = 0; d < opts.days; d++) {
    const dayStart = start + d * DAY;
    for (const walkHour of [7, 18]) {
      const minutes = Math.max(8, Math.round(base + gaussian(rng, 0, 5)));
      events.push({
        device_id: opts.deviceId,
        pet_id: opts.petId,
        event_type: 'activity_session',
        occurred_at: iso(dayStart + walkHour * HOUR + randInt(rng, 0, 30) * 60_000),
        payload: {
          duration_minutes: minutes,
          distance_m: Math.round(minutes * (55 + gaussian(rng, 0, 8))),
          avg_pace: 'normal',
        },
      });
    }
  }
  return events;
}

/** Nightly sleep session per pet. */
export function sleepSeries(
  rng: Rng,
  opts: { deviceId: string; petId: string; days: number; endMs: number },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  for (let d = 0; d < opts.days; d++) {
    const hours = 10.5 + gaussian(rng, 0, 0.7);
    events.push({
      device_id: opts.deviceId,
      pet_id: opts.petId,
      event_type: 'sleep_session',
      occurred_at: iso(start + d * DAY + 21 * HOUR),
      payload: { duration_hours: Math.round(hours * 10) / 10, interruptions: randInt(rng, 0, 3) },
    });
  }
  return events;
}

/**
 * Shared feeder: scheduled dispenses at 7:00 and 18:00, followed by per-pet
 * attributed feeding sessions (collar tag read at the bowl).
 */
export function feedingSeries(
  rng: Rng,
  opts: { deviceId: string; petIds: string[]; days: number; endMs: number; gramsPerPet?: number },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  const grams = opts.gramsPerPet ?? 55;
  for (let d = 0; d < opts.days; d++) {
    const dayStart = start + d * DAY;
    for (const feedHour of [7, 18]) {
      const dispenseAt = dayStart + feedHour * HOUR + randInt(rng, 0, 2) * 60_000;
      events.push({
        device_id: opts.deviceId,
        pet_id: null,
        event_type: 'device_health_ping',
        occurred_at: iso(dispenseAt),
        payload: {
          check: 'scheduled_dispense',
          scheduled_for: iso(dayStart + feedHour * HOUR),
          dispensed_at: iso(dispenseAt),
          drift_minutes: Math.round((dispenseAt - (dayStart + feedHour * HOUR)) / 60_000),
        },
      });
      for (const petId of opts.petIds) {
        events.push({
          device_id: opts.deviceId,
          pet_id: petId,
          event_type: 'feeding_session',
          occurred_at: iso(dispenseAt + randInt(rng, 2, 12) * 60_000),
          payload: {
            grams_consumed: Math.max(20, Math.round(grams + gaussian(rng, 0, 6))),
            duration_seconds: randInt(rng, 90, 240),
          },
        });
      }
    }
  }
  return events;
}

/**
 * Fountain visits: 6-10 per pet per day with volume + flow rate. Cold days
 * (below `coldBelowF`) naturally reduce visit count, tying environment to behavior.
 */
export function drinkingSeries(
  rng: Rng,
  opts: {
    deviceId: string;
    petId: string;
    days: number;
    endMs: number;
    mlPerVisit?: number;
    dailyTempsF?: number[];
    coldBelowF?: number;
  },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  const mlBase = opts.mlPerVisit ?? 85;
  for (let d = 0; d < opts.days; d++) {
    const temp = opts.dailyTempsF?.[d];
    const cold = temp !== undefined && temp < (opts.coldBelowF ?? 20);
    // Pets are creatures of habit: visit count stays tight so a real change stands out.
    const visits = cold ? randInt(rng, 4, 5) : randInt(rng, 7, 9);
    for (let v = 0; v < visits; v++) {
      const at = start + d * DAY + randInt(rng, 6, 21) * HOUR + randInt(rng, 0, 59) * 60_000;
      events.push({
        device_id: opts.deviceId,
        pet_id: opts.petId,
        event_type: 'drinking_session',
        occurred_at: iso(at),
        payload: {
          duration_seconds: randInt(rng, 15, 50),
          estimated_volume_ml: Math.max(20, Math.round(mlBase + gaussian(rng, 0, 8))),
          flow_rate_ml_s: Math.round((9 + gaussian(rng, 0, 0.5)) * 10) / 10,
        },
      });
    }
  }
  return events;
}

/** Daily device health pings: battery, firmware, signal. */
export function deviceHealthSeries(
  rng: Rng,
  opts: { deviceId: string; days: number; endMs: number; startBatteryPct?: number; drainPerDay?: number },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  const startPct = opts.startBatteryPct ?? 100;
  const drain = opts.drainPerDay ?? 1.4;
  for (let d = 0; d < opts.days; d++) {
    events.push({
      device_id: opts.deviceId,
      pet_id: null,
      event_type: 'device_health_ping',
      occurred_at: iso(start + d * DAY + 3 * HOUR),
      payload: {
        check: 'daily_status',
        battery_pct: Math.min(100, Math.max(5, Math.round(startPct - d * drain + gaussian(rng, 0, 0.5)))),
        signal_strength: randInt(rng, 3, 5),
        firmware: '2.4.1',
      },
    });
  }
  return events;
}

/**
 * One GPS wander step: small gaussian move (~3-6 m), clamped back toward the
 * yard center whenever the step would leave the boundary polygon (clamp, not
 * a rejection loop — cannot spin). ~0.00004° ≈ 4.4 m of latitude.
 */
export function nextWanderPoint(rng: Rng, prev: LatLng, yard: YardGeometry): LatLng {
  const step = 0.00004;
  const next: LatLng = {
    lat: prev.lat + gaussian(rng, 0, step),
    lng: prev.lng + gaussian(rng, 0, step * 1.35),
  };
  if (!pointInPolygon(next, yard.polygon)) {
    return {
      lat: prev.lat + (yard.center.lat - prev.lat) * 0.5,
      lng: prev.lng + (yard.center.lng - prev.lng) * 0.5,
    };
  }
  return next;
}

/** Collar GPS check-ins every 15 minutes, wandering inside the yard boundary. */
export function boundaryCheckSeries(
  rng: Rng,
  opts: { deviceId: string; petId: string; days: number; endMs: number; yard: YardGeometry },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  let pos: LatLng = { ...opts.yard.center };
  for (let t = start; t < opts.endMs; t += BOUNDARY_CHECK_INTERVAL_MIN * 60_000) {
    pos = nextWanderPoint(rng, pos, opts.yard);
    events.push({
      device_id: opts.deviceId,
      pet_id: opts.petId,
      event_type: 'boundary_check',
      occurred_at: iso(t),
      payload: {
        lat: Math.round(pos.lat * 1e6) / 1e6,
        lng: Math.round(pos.lng * 1e6) / 1e6,
        boundary_status: 'inside',
        gps_accuracy_m: randInt(rng, 2, 6),
      },
    });
  }
  return events;
}

/** July-appropriate Chicago daily temperatures for env context rows. */
export function chicagoSummerTemps(rng: Rng, days: number): { low: number; high: number }[] {
  return Array.from({ length: days }, () => {
    const high = Math.round(84 + gaussian(rng, 0, 5));
    return { low: high - randInt(rng, 12, 18), high };
  });
}

/**
 * Smart-door passages: out/in pairs during waking hours (07:00-21:00 UTC-ish),
 * none during the seeded curfew. Dogs cross more than cats; every crossing is
 * an out followed 10-45 min later by an in.
 */
export function doorPassageSeries(
  rng: Rng,
  opts: { deviceId: string; petId: string; days: number; endMs: number; tripsPerDay: [number, number] },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  for (let d = 0; d < opts.days; d++) {
    const trips = randInt(rng, opts.tripsPerDay[0], opts.tripsPerDay[1]);
    for (let i = 0; i < trips; i++) {
      // Waking window 12:00-02:00 UTC ≈ 07:00-21:00 Chicago.
      const outAt = start + d * DAY + 12 * HOUR + Math.floor(rng() * 14 * HOUR);
      const inAt = outAt + randInt(rng, 10, 45) * 60_000;
      if (inAt >= opts.endMs) continue;
      for (const [t, direction] of [
        [outAt, 'out'],
        [inAt, 'in'],
      ] as const) {
        events.push({
          device_id: opts.deviceId,
          pet_id: opts.petId,
          event_type: 'door_passage',
          occurred_at: iso(t),
          payload: { direction, method: 'collar_tag', flap_ms: randInt(rng, 700, 1400) },
        });
      }
    }
  }
  return events;
}

/** Litter box visits: steady frequency + duration + weigh-in per visit. */
export function litterVisitSeries(
  rng: Rng,
  opts: { deviceId: string; petId: string; days: number; endMs: number; visitsPerDay?: [number, number]; weightLbs?: number },
): GeneratedEvent[] {
  const events: GeneratedEvent[] = [];
  const start = opts.endMs - opts.days * DAY;
  const [lo, hi] = opts.visitsPerDay ?? [3, 4];
  const weight = opts.weightLbs ?? 9.5;
  for (let d = 0; d < opts.days; d++) {
    const visits = randInt(rng, lo, hi);
    for (let i = 0; i < visits; i++) {
      const at = start + d * DAY + Math.floor(rng() * DAY);
      if (at >= opts.endMs) continue;
      events.push({
        device_id: opts.deviceId,
        pet_id: opts.petId,
        event_type: 'litter_visit',
        occurred_at: iso(at),
        payload: {
          duration_s: randInt(rng, 60, 180),
          weight_lbs: Math.round((weight + gaussian(rng, 0, 0.15)) * 100) / 100,
          clump_detected: true,
        },
      });
    }
  }
  return events;
}
