import {
  SIGNAL_LOSS_MIN,
  BOUNDARY_CHECK_INTERVAL_MIN,
  YARD_GEOMETRIES,
  type ContainmentEvent,
  type ContainmentPetStatus,
  type ContainmentStatus,
  type LatLng,
} from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { mulberry32 } from '../db/seed/rng';
import { nextWanderPoint } from '../db/seed/generators';
import { SEED } from '../db/seed';

/**
 * Containment status derivation + the lazy top-up that keeps the yard map
 * looking live without a background job.
 */

const MIN = 60_000;

interface CollarRow {
  device_id: string;
  device_status: 'active' | 'low_battery' | 'offline' | 'needs_service';
  model: string | null;
  pet_id: string;
  pet_name: string;
}

interface EventRow {
  pet_id: string | null;
  event_type: string;
  payload: string;
  occurred_at: string;
}

function collarsForHousehold(db: Db, householdId: string): CollarRow[] {
  return db
    .prepare(
      `SELECT d.id AS device_id, d.status AS device_status, d.model, p.id AS pet_id, p.name AS pet_name
       FROM devices d
       JOIN device_pet_links l ON l.device_id = d.id AND l.unlinked_at IS NULL
       JOIN pets p ON p.id = l.pet_id AND p.deleted_at IS NULL
       WHERE d.household_id = ? AND d.device_type = 'containment_collar' AND d.deleted_at IS NULL`,
    )
    .all(householdId) as CollarRow[];
}

function latestContainmentEvent(db: Db, deviceId: string): EventRow | undefined {
  return db
    .prepare(
      `SELECT pet_id, event_type, payload, occurred_at FROM telemetry_events
       WHERE device_id = ? AND event_type IN ('boundary_check', 'boundary_event')
       ORDER BY occurred_at DESC LIMIT 1`,
    )
    .get(deviceId) as EventRow | undefined;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h;
}

/**
 * Synthesizes any missing 15-minute boundary_check events from each collar's
 * last check-in up to now, so the map never freezes at seed time. Skips:
 * - offline collars (the signal-lost scenario owns that silence), and
 * - collars whose latest containment event is an unreturned breach (the
 *   emergency scenario keeps the pet visibly outside the fence).
 * Deterministic and idempotent: each synthesized event's PRNG is seeded from
 * (deviceId, interval index), never a shared advancing stream.
 *
 * PRODUCTION NOTE: real collars stream continuously; this exists only so a
 * seeded demo database stays believable while it sits open on a screen.
 */
export function topUpBoundaryChecks(db: Db, householdId: string, now: number = Date.now()): void {
  const yard = YARD_GEOMETRIES[householdId];
  if (!yard) return;

  const insert = db.prepare(`
    INSERT INTO telemetry_events (id, household_id, device_id, pet_id, device_type, event_type, payload, schema_version, occurred_at, received_at)
    VALUES (?, ?, ?, ?, 'containment_collar', 'boundary_check', ?, 1, ?, ?)
  `);

  for (const collar of collarsForHousehold(db, householdId)) {
    if (collar.device_status === 'offline') continue;
    const latest = latestContainmentEvent(db, collar.device_id);
    if (!latest) continue;
    if (latest.event_type === 'boundary_event') {
      const p = JSON.parse(latest.payload) as { status?: string };
      if (p.status === 'breach') continue; // unreturned breach — leave the pet outside
    }

    let pos: LatLng = yard.center;
    if (latest.event_type === 'boundary_check') {
      const p = JSON.parse(latest.payload) as { lat?: number; lng?: number };
      if (typeof p.lat === 'number' && typeof p.lng === 'number') pos = { lat: p.lat, lng: p.lng };
    }

    const intervalMs = BOUNDARY_CHECK_INTERVAL_MIN * MIN;
    let t = Date.parse(latest.occurred_at) + intervalMs;
    for (; t <= now; t += intervalMs) {
      const intervalIndex = Math.floor(t / intervalMs);
      const rng = mulberry32((SEED ^ hashId(collar.device_id) ^ intervalIndex) >>> 0);
      pos = nextWanderPoint(rng, pos, yard);
      const at = new Date(t).toISOString();
      insert.run(
        uuid(),
        householdId,
        collar.device_id,
        collar.pet_id,
        JSON.stringify({
          lat: Math.round(pos.lat * 1e6) / 1e6,
          lng: Math.round(pos.lng * 1e6) / 1e6,
          boundary_status: 'inside',
          gps_accuracy_m: 3,
        }),
        at,
        at,
      );
    }
  }
}

/** Per-pet zone status: the single most recent containment-channel event wins. */
export function getContainmentStatus(db: Db, householdId: string, now: number = Date.now()): ContainmentStatus {
  const yard = YARD_GEOMETRIES[householdId] ?? {
    center: { lat: 0, lng: 0 },
    polygon: [],
    label: 'No boundary configured',
  };

  const pets: ContainmentPetStatus[] = collarsForHousehold(db, householdId).map((collar) => {
    const latest = latestContainmentEvent(db, collar.device_id);
    const ping = db
      .prepare(
        `SELECT payload FROM telemetry_events
         WHERE device_id = ? AND event_type = 'device_health_ping' ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get(collar.device_id) as { payload: string } | undefined;
    const health = ping ? (JSON.parse(ping.payload) as { battery_pct?: number; signal_strength?: number }) : {};

    let zone: ContainmentPetStatus['zone_status'] = 'unknown';
    let position: LatLng | null = null;
    let lastCheckIn: string | null = null;
    let minutesSince: number | null = null;

    if (latest) {
      const p = JSON.parse(latest.payload) as {
        status?: string;
        lat?: number;
        lng?: number;
        last_known_position?: LatLng;
        position?: LatLng;
      };
      lastCheckIn = latest.occurred_at;
      minutesSince = Math.max(Math.round((now - Date.parse(latest.occurred_at)) / MIN), 0);

      if (latest.event_type === 'boundary_event') {
        if (p.status === 'breach') {
          zone = 'outside';
          position = p.last_known_position ?? null;
        } else {
          zone = 'inside';
          position = p.position ?? null;
        }
      } else {
        zone = 'inside';
        position = typeof p.lat === 'number' && typeof p.lng === 'number' ? { lat: p.lat, lng: p.lng } : null;
      }
    }

    const signalLost =
      collar.device_status === 'offline' || minutesSince === null || minutesSince >= SIGNAL_LOSS_MIN;
    if (signalLost && zone !== 'outside') zone = 'unknown';

    const containmentState: ContainmentPetStatus['containment_state'] =
      zone === 'outside' ? 'breach' : signalLost ? 'signal_lost' : 'protected';

    return {
      pet_id: collar.pet_id,
      name: collar.pet_name,
      device_id: collar.device_id,
      device_label: collar.model ?? 'Containment collar',
      device_status: collar.device_status,
      zone_status: zone,
      containment_state: containmentState,
      last_position: position,
      last_check_in: lastCheckIn,
      minutes_since_check_in: minutesSince,
      battery_pct: health.battery_pct ?? null,
      signal_strength: health.signal_strength ?? null,
    };
  });

  const recent_events = buildTimeline(db, householdId, now);

  const anyBreach = pets.some((p) => p.containment_state === 'breach');
  const anyDegraded = pets.some(
    (p) => p.containment_state === 'signal_lost' || p.device_status === 'low_battery' || (p.battery_pct ?? 100) <= 20,
  );

  return {
    household_id: householdId,
    boundary: yard,
    overall: anyBreach ? 'alert' : anyDegraded ? 'degraded' : 'all_safe',
    pets,
    recent_events,
  };
}

function buildTimeline(db: Db, householdId: string, now: number): ContainmentEvent[] {
  const since = new Date(now - 48 * 60 * MIN).toISOString();
  const rows = db
    .prepare(
      `SELECT te.pet_id, te.event_type, te.payload, te.occurred_at, p.name AS pet_name
       FROM telemetry_events te LEFT JOIN pets p ON p.id = te.pet_id
       WHERE te.household_id = ? AND te.event_type = 'boundary_event' AND te.occurred_at >= ?
       ORDER BY te.occurred_at DESC LIMIT 10`,
    )
    .all(householdId, since) as (EventRow & { pet_name: string | null })[];

  const events: ContainmentEvent[] = rows.map((r) => {
    const p = JSON.parse(r.payload) as { status?: string; minutes_outside_zone?: number; motion_detected?: boolean };
    if (p.status === 'breach') {
      return {
        occurred_at: r.occurred_at,
        pet_id: r.pet_id,
        pet_name: r.pet_name,
        kind: 'breach',
        detail: `${p.minutes_outside_zone ?? 0} min outside the zone${p.motion_detected === false ? ', no motion detected' : ''}`,
      };
    }
    return {
      occurred_at: r.occurred_at,
      pet_id: r.pet_id,
      pet_name: r.pet_name,
      kind: 'return_to_zone',
      detail: `returned to the safe zone after ${p.minutes_outside_zone ?? 0} min`,
    };
  });

  // Signal-loss entries come from safety insights, so the timeline shows them too.
  const signalInsights = db
    .prepare(
      `SELECT pet_id, generated_at, summary FROM insights
       WHERE household_id = ? AND metric = 'containment_signal' AND generated_at >= ?
       ORDER BY generated_at DESC LIMIT 5`,
    )
    .all(householdId, since) as { pet_id: string | null; generated_at: string; summary: string }[];
  for (const i of signalInsights) {
    const pet = i.pet_id
      ? (db.prepare(`SELECT name FROM pets WHERE id = ?`).get(i.pet_id) as { name: string } | undefined)
      : undefined;
    events.push({
      occurred_at: i.generated_at,
      pet_id: i.pet_id,
      pet_name: pet?.name ?? null,
      kind: 'signal_lost',
      detail: 'collar stopped checking in — containment unverified',
    });
  }

  return events.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 20);
}
