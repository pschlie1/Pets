import {
  SIGNAL_LOSS_MIN,
  BOUNDARY_CHECK_INTERVAL_MIN,
  HOUSEHOLD_TZ,
  YARD_GEOMETRIES,
  type ContainmentEvent,
  type ContainmentPetStatus,
  type ContainmentStatus,
  type DayBoundaryEvent,
  type DayHistoryResponse,
  type DayPathPoint,
  type HeatmapPet,
  type HeatmapResponse,
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

/* ------------------------------------------------------------------------- *
 * Movement history: heat map + day review, both fed purely by the
 * boundary_check GPS record that seeding and top-up already maintain.
 * ------------------------------------------------------------------------- */

const HEAT_COLS = 24;
const HEAT_ROWS = 18;
/** Same padding the yard map uses, so heat cells line up with the rendered yard. */
const HEAT_PAD = 0.22;

interface CheckRow {
  pet_id: string;
  payload: string;
  occurred_at: string;
}

/** Local meters per degree at the yard's latitude (equirectangular). */
function metersPerDegree(lat: number): { mLat: number; mLng: number } {
  return { mLat: 110_574, mLng: 111_320 * Math.cos((lat * Math.PI) / 180) };
}

/** Bins each collared pet's boundary_check positions into a fixed grid over the yard. */
export function getMovementHeatmap(
  db: Db,
  householdId: string,
  days: number,
  petId: string | null,
  now: number = Date.now(),
): HeatmapResponse {
  const yard = YARD_GEOMETRIES[householdId];
  const empty: HeatmapResponse = {
    household_id: householdId,
    days,
    cols: HEAT_COLS,
    rows: HEAT_ROWS,
    bbox: null,
    pets: [],
  };
  if (!yard || yard.polygon.length === 0) return empty;

  const lats = yard.polygon.map((p) => p.lat);
  const lngs = yard.polygon.map((p) => p.lng);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lngSpan = Math.max(...lngs) - Math.min(...lngs);
  const bbox = {
    min_lat: Math.min(...lats) - latSpan * HEAT_PAD,
    max_lat: Math.max(...lats) + latSpan * HEAT_PAD,
    min_lng: Math.min(...lngs) - lngSpan * HEAT_PAD,
    max_lng: Math.max(...lngs) + lngSpan * HEAT_PAD,
  };

  const since = new Date(now - days * 24 * 60 * MIN).toISOString();
  const pets: HeatmapPet[] = [];
  for (const collar of collarsForHousehold(db, householdId)) {
    if (petId && collar.pet_id !== petId) continue;
    const rows = db
      .prepare(
        `SELECT payload FROM telemetry_events
         WHERE device_id = ? AND event_type = 'boundary_check' AND occurred_at >= ?`,
      )
      .all(collar.device_id, since) as { payload: string }[];

    const counts = new Map<number, number>();
    let total = 0;
    for (const row of rows) {
      const p = JSON.parse(row.payload) as { lat?: number; lng?: number };
      if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
      // Row 0 is the north edge so the grid reads like the rendered map.
      const c = Math.floor(((p.lng - bbox.min_lng) / (bbox.max_lng - bbox.min_lng)) * HEAT_COLS);
      const r = Math.floor(((bbox.max_lat - p.lat) / (bbox.max_lat - bbox.min_lat)) * HEAT_ROWS);
      if (c < 0 || c >= HEAT_COLS || r < 0 || r >= HEAT_ROWS) continue;
      counts.set(r * HEAT_COLS + c, (counts.get(r * HEAT_COLS + c) ?? 0) + 1);
      total += 1;
    }
    const cells = [...counts.entries()].map(([key, count]) => ({
      r: Math.floor(key / HEAT_COLS),
      c: key % HEAT_COLS,
      count,
    }));
    pets.push({
      pet_id: collar.pet_id,
      name: collar.pet_name,
      total_points: total,
      max_cell_count: cells.reduce((m, cell) => Math.max(m, cell.count), 0),
      cells,
    });
  }
  return { ...empty, bbox, pets };
}

/** YYYY-MM-DD of an instant in the household's timezone. */
export function localDate(ms: number, tz: string = HOUSEHOLD_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
}

/** Local hour (0-23) of an ISO instant in the household's timezone. */
function localHour(iso: string, tz: string = HOUSEHOLD_TZ): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(iso),
    ),
  );
}

/**
 * UTC window [start, end) covering one household-local calendar day. Walks
 * hour-by-hour instead of assuming a fixed offset, so DST days stay correct.
 */
function localDayWindow(date: string, tz: string = HOUSEHOLD_TZ): { start: number; end: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const guess = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(guess)) return null;
  // Scan a generous window around the naive UTC midnight for instants whose
  // local date matches; the min/max hour edges bound the local day.
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (let t = guess - 30 * 60 * MIN; t <= guess + 54 * 60 * MIN; t += 60 * MIN) {
    if (localDate(t, tz) === date) {
      start = Math.min(start, t);
      end = Math.max(end, t + 60 * MIN);
    }
  }
  return Number.isFinite(start) ? { start, end } : null;
}

/** Everything each collared pet did on one household-local calendar day. */
export function getDayHistory(
  db: Db,
  householdId: string,
  date: string,
  now: number = Date.now(),
): DayHistoryResponse | null {
  const window = localDayWindow(date);
  if (!window) return null;
  const startIso = new Date(window.start).toISOString();
  const endIso = new Date(Math.min(window.end, now)).toISOString();
  const { mLat, mLng } = metersPerDegree(YARD_GEOMETRIES[householdId]?.center.lat ?? 41.9);

  const pets = collarsForHousehold(db, householdId).map((collar) => {
    const checks = db
      .prepare(
        `SELECT pet_id, payload, occurred_at FROM telemetry_events
         WHERE device_id = ? AND event_type = 'boundary_check' AND occurred_at >= ? AND occurred_at < ?
         ORDER BY occurred_at ASC`,
      )
      .all(collar.device_id, startIso, endIso) as CheckRow[];

    const points: DayPathPoint[] = [];
    for (const row of checks) {
      const p = JSON.parse(row.payload) as { lat?: number; lng?: number };
      if (typeof p.lat === 'number' && typeof p.lng === 'number') {
        points.push({ t: row.occurred_at, lat: p.lat, lng: p.lng });
      }
    }

    let distance = 0;
    const hourly = new Map<number, number>();
    for (let i = 1; i < points.length; i++) {
      const step = Math.hypot(
        (points[i].lat - points[i - 1].lat) * mLat,
        (points[i].lng - points[i - 1].lng) * mLng,
      );
      distance += step;
      const hour = localHour(points[i].t);
      hourly.set(hour, (hourly.get(hour) ?? 0) + step);
    }
    const busiest = [...hourly.entries()].sort((a, b) => b[1] - a[1])[0];

    const events: DayBoundaryEvent[] = (
      db
        .prepare(
          `SELECT payload, occurred_at FROM telemetry_events
           WHERE device_id = ? AND event_type = 'boundary_event' AND occurred_at >= ? AND occurred_at < ?
           ORDER BY occurred_at ASC`,
        )
        .all(collar.device_id, startIso, endIso) as { payload: string; occurred_at: string }[]
    ).map((row) => {
      const p = JSON.parse(row.payload) as {
        status?: string;
        minutes_outside_zone?: number;
        last_known_position?: LatLng;
        position?: LatLng;
      };
      const breach = p.status === 'breach';
      return {
        occurred_at: row.occurred_at,
        kind: breach ? ('breach' as const) : ('return_to_zone' as const),
        position: (breach ? p.last_known_position : p.position) ?? null,
        detail: breach
          ? `crossed the boundary${p.minutes_outside_zone ? ` — ${p.minutes_outside_zone} min outside` : ''}`
          : `returned to the safe zone${p.minutes_outside_zone ? ` after ${p.minutes_outside_zone} min` : ''}`,
      };
    });

    return {
      pet_id: collar.pet_id,
      name: collar.pet_name,
      points,
      events,
      stats: {
        distance_m: Math.round(distance),
        checks: points.length,
        boundary_events: events.length,
        busiest_hour: busiest ? busiest[0] : null,
      },
    };
  });

  // The last 7 household-local dates that actually have movement data.
  const available_dates: string[] = [];
  for (let d = 0; d < 7; d++) available_dates.push(localDate(now - d * 24 * 60 * MIN));

  return { household_id: householdId, date, timezone: HOUSEHOLD_TZ, available_dates, pets };
}
