/**
 * Containment system: yard geometry, thresholds, and the containment status
 * contract shared by the seed generator, the API status endpoint, and the
 * web yard map — one source of truth, exactly like scenarios.ts.
 *
 * PRODUCTION NOTE: boundary geometry would live on the household record (or a
 * dedicated zones table) in production. A shared constant avoids a schema
 * migration in the demo while keeping all three consumers in lockstep.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface YardGeometry {
  center: LatLng;
  /** Irregular rounded yard, ~70 x 64 m. */
  polygon: LatLng[];
  label: string;
}

export const YARD_GEOMETRIES: Record<string, YardGeometry> = {
  hh_2291: {
    center: { lat: 41.9208, lng: -87.6525 },
    polygon: [
      { lat: 41.92103, lng: -87.65288 },
      { lat: 41.92108, lng: -87.65262 },
      { lat: 41.921, lng: -87.6523 },
      { lat: 41.92085, lng: -87.65208 },
      { lat: 41.92062, lng: -87.6521 },
      { lat: 41.9205, lng: -87.65235 },
      { lat: 41.92053, lng: -87.65272 },
      { lat: 41.9207, lng: -87.65292 },
    ],
    label: 'Backyard — Boundary Plus zone',
  },
};

/** Collar GPS check-in cadence. */
export const BOUNDARY_CHECK_INTERVAL_MIN = 15;
/** A check-in older than this reads as "stale" in the UI. */
export const SIGNAL_STALE_MIN = 20;
/** Three missed check-ins → containment blind-spot insight. */
export const SIGNAL_LOSS_MIN = 45;

/** Ray-casting point-in-polygon. Pure; used by seed, engine, and tests. */
export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.lng > p.lng !== b.lng > p.lng &&
      p.lat < ((b.lat - a.lat) * (p.lng - a.lng)) / (b.lng - a.lng) + a.lat;
    if (intersects) inside = !inside;
  }
  return inside;
}

export type ZoneStatus = 'inside' | 'outside' | 'unknown';
export type ContainmentState = 'protected' | 'breach' | 'signal_lost';
export type ContainmentOverall = 'all_safe' | 'alert' | 'degraded';

export interface ContainmentPetStatus {
  pet_id: string;
  name: string;
  device_id: string;
  device_label: string;
  device_status: 'active' | 'low_battery' | 'offline' | 'needs_service';
  zone_status: ZoneStatus;
  containment_state: ContainmentState;
  last_position: LatLng | null;
  last_check_in: string | null;
  minutes_since_check_in: number | null;
  battery_pct: number | null;
  signal_strength: number | null;
}

export interface ContainmentEvent {
  occurred_at: string;
  pet_id: string | null;
  pet_name: string | null;
  kind: 'breach' | 'return_to_zone' | 'signal_lost' | 'check';
  detail: string;
}

export interface ContainmentStatus {
  household_id: string;
  boundary: YardGeometry;
  overall: ContainmentOverall;
  pets: ContainmentPetStatus[];
  recent_events: ContainmentEvent[];
}
