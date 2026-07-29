import type { Db } from '../connection';
import { uuid } from '../connection';
import { seedBreedProfiles, BREED_IDS } from './breeds';
import { PET_PHOTOS_B64 } from './photos';
import { mulberry32 } from './rng';
import { YARD_GEOMETRIES } from '@connected-care/shared';
import {
  activitySeries,
  boundaryCheckSeries,
  chicagoSummerTemps,
  deviceHealthSeries,
  drinkingSeries,
  feedingSeries,
  heartRateSeries,
  sleepSeries,
  type GeneratedEvent,
} from './generators';
import { recomputeBaselines } from '../../engine/baselines';

export const SEED = 20260728;
export const SEED_DAYS = 21;

/** Fixed IDs so the demo UI and scenario injectors can reference the reference household directly. */
export const REF = {
  householdId: 'hh_2291',
  meeko: 'pet_5001',
  lilo: 'pet_5002',
  meekoCollar: 'dev_collar_5001',
  liloCollar: 'dev_collar_5002',
  feeder: 'dev_feeder_9001',
  fountain: 'dev_fountain_9002',
  zip: '60614',
} as const;

export const REF2 = {
  householdId: 'hh_3350',
  duke: 'pet_6001',
  ash: 'pet_6002',
  fountain: 'dev_fountain_7001',
  zip: '60622',
} as const;

function insertEvents(db: Db, householdId: string, deviceTypes: Map<string, string>, events: GeneratedEvent[]): void {
  const stmt = db.prepare(`
    INSERT INTO telemetry_events (id, household_id, device_id, pet_id, device_type, event_type, payload, schema_version, occurred_at, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const e of events) {
    stmt.run(
      uuid(),
      householdId,
      e.device_id,
      e.pet_id,
      deviceTypes.get(e.device_id) ?? 'containment_collar',
      e.event_type,
      JSON.stringify(e.payload),
      e.occurred_at,
      e.occurred_at,
    );
  }
}

function insertEnv(db: Db, zip: string, temps: { low: number; high: number }[], endMs: number): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO environmental_context (id, location_zip, date, temperature_low_f, temperature_high_f, conditions)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const DAY = 86_400_000;
  const start = endMs - temps.length * DAY;
  temps.forEach((t, i) => {
    const date = new Date(start + i * DAY).toISOString().slice(0, 10);
    stmt.run(uuid(), zip, date, t.low, t.high, t.high >= 88 ? 'hot and sunny' : 'partly cloudy');
  });
}

/**
 * Seeds the Meeko & Lilo reference household with SEED_DAYS of realistic
 * telemetry, plus the Duke & Ash household proving species flexibility.
 * Deterministic: same PRNG seed → identical data on every reset.
 */
export function seedAll(db: Db, now: number = Date.now()): void {
  const rng = mulberry32(SEED);

  db.transaction(() => {
    seedBreedProfiles(db);

    // --- Reference household: two Cavaliers in Chicago ---
    db.prepare(
      `INSERT INTO households (id, location_city, location_state, location_zip, climate_zone) VALUES (?, 'Chicago', 'IL', ?, '6a')`,
    ).run(REF.householdId, REF.zip);

    const petStmt = db.prepare(`
      INSERT INTO pets (id, household_id, name, species, breed_id, breed_reference_confidence, date_of_birth, weight_lbs, sex)
      VALUES (?, ?, ?, ?, ?, 'high', ?, ?, ?)
    `);
    petStmt.run(REF.meeko, REF.householdId, 'Meeko', 'dog', BREED_IDS.ckcs, '2017-04-12', 21.0, 'male');
    petStmt.run(REF.lilo, REF.householdId, 'Lilo', 'dog', BREED_IDS.ckcs, '2018-06-03', 20.0, 'male');
    // Owner-provided profile photos, served via GET /v1/pets/:id/photo.
    const photoStmt = db.prepare(`UPDATE pets SET photo = ? WHERE id = ?`);
    for (const [petId, b64] of Object.entries(PET_PHOTOS_B64)) {
      photoStmt.run(Buffer.from(b64, 'base64'), petId);
    }

    const devStmt = db.prepare(`
      INSERT INTO devices (id, household_id, device_type, model, assignment_mode, has_pet_attribution)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    devStmt.run(REF.meekoCollar, REF.householdId, 'containment_collar', 'Boundary Plus GPS 2.0', 'dedicated');
    devStmt.run(REF.liloCollar, REF.householdId, 'containment_collar', 'Boundary Plus GPS 2.0', 'dedicated');
    devStmt.run(REF.feeder, REF.householdId, 'feeder', 'Connected Care Smart Feeder', 'shared');
    devStmt.run(REF.fountain, REF.householdId, 'fountain', 'Connected Care Smart Fountain', 'shared');

    const linkStmt = db.prepare(`INSERT INTO device_pet_links (id, device_id, pet_id) VALUES (?, ?, ?)`);
    for (const [dev, pet] of [
      [REF.meekoCollar, REF.meeko],
      [REF.liloCollar, REF.lilo],
      [REF.feeder, REF.meeko],
      [REF.feeder, REF.lilo],
      [REF.fountain, REF.meeko],
      [REF.fountain, REF.lilo],
    ] as const) {
      linkStmt.run(uuid(), dev, pet);
    }

    const deviceTypes = new Map<string, string>([
      [REF.meekoCollar, 'containment_collar'],
      [REF.liloCollar, 'containment_collar'],
      [REF.feeder, 'feeder'],
      [REF.fountain, 'fountain'],
    ]);

    const temps = chicagoSummerTemps(rng, SEED_DAYS);
    insertEnv(db, REF.zip, temps, now);
    const tempHighs = temps.map((t) => t.high);

    const events: GeneratedEvent[] = [
      // Meeko: mean 98 σ6 · Lilo: mean 92 σ5 (matches PRD baselines)
      ...heartRateSeries(rng, { deviceId: REF.meekoCollar, petId: REF.meeko, mean: 98, stdev: 6, days: SEED_DAYS, endMs: now }),
      ...heartRateSeries(rng, { deviceId: REF.liloCollar, petId: REF.lilo, mean: 92, stdev: 5, days: SEED_DAYS, endMs: now }),
      ...activitySeries(rng, { deviceId: REF.meekoCollar, petId: REF.meeko, days: SEED_DAYS, endMs: now, baseMinutes: 28 }),
      ...activitySeries(rng, { deviceId: REF.liloCollar, petId: REF.lilo, days: SEED_DAYS, endMs: now, baseMinutes: 26 }),
      ...sleepSeries(rng, { deviceId: REF.meekoCollar, petId: REF.meeko, days: SEED_DAYS, endMs: now }),
      ...sleepSeries(rng, { deviceId: REF.liloCollar, petId: REF.lilo, days: SEED_DAYS, endMs: now }),
      ...feedingSeries(rng, { deviceId: REF.feeder, petIds: [REF.meeko, REF.lilo], days: SEED_DAYS, endMs: now }),
      ...drinkingSeries(rng, { deviceId: REF.fountain, petId: REF.meeko, days: SEED_DAYS, endMs: now, dailyTempsF: tempHighs }),
      ...drinkingSeries(rng, { deviceId: REF.fountain, petId: REF.lilo, days: SEED_DAYS, endMs: now, mlPerVisit: 78, dailyTempsF: tempHighs }),
      ...boundaryCheckSeries(rng, { deviceId: REF.meekoCollar, petId: REF.meeko, days: SEED_DAYS, endMs: now, yard: YARD_GEOMETRIES[REF.householdId] }),
      ...boundaryCheckSeries(rng, { deviceId: REF.liloCollar, petId: REF.lilo, days: SEED_DAYS, endMs: now, yard: YARD_GEOMETRIES[REF.householdId] }),
      ...deviceHealthSeries(rng, { deviceId: REF.meekoCollar, days: SEED_DAYS, endMs: now, startBatteryPct: 98 }),
      ...deviceHealthSeries(rng, { deviceId: REF.liloCollar, days: SEED_DAYS, endMs: now, startBatteryPct: 96 }),
      ...deviceHealthSeries(rng, { deviceId: REF.fountain, days: SEED_DAYS, endMs: now, startBatteryPct: 100, drainPerDay: 0 }),
    ];
    insertEvents(db, REF.householdId, deviceTypes, events);

    // --- Second household: Duke (Labrador) + Ash (cat) sharing a fountain ---
    db.prepare(
      `INSERT INTO households (id, location_city, location_state, location_zip, climate_zone) VALUES (?, 'Chicago', 'IL', ?, '6a')`,
    ).run(REF2.householdId, REF2.zip);
    petStmt.run(REF2.duke, REF2.householdId, 'Duke', 'dog', BREED_IDS.lab, '2020-02-01', 68.0, 'male');
    petStmt.run(REF2.ash, REF2.householdId, 'Ash', 'cat', BREED_IDS.catDsh, '2021-09-15', 9.5, 'female');
    devStmt.run(REF2.fountain, REF2.householdId, 'fountain', 'Connected Care Smart Fountain', 'shared');
    linkStmt.run(uuid(), REF2.fountain, REF2.duke);
    linkStmt.run(uuid(), REF2.fountain, REF2.ash);

    const deviceTypes2 = new Map([[REF2.fountain, 'fountain']]);
    insertEnv(db, REF2.zip, chicagoSummerTemps(rng, SEED_DAYS), now);
    insertEvents(db, REF2.householdId, deviceTypes2, [
      ...drinkingSeries(rng, { deviceId: REF2.fountain, petId: REF2.duke, days: SEED_DAYS, endMs: now, mlPerVisit: 180 }),
      ...drinkingSeries(rng, { deviceId: REF2.fountain, petId: REF2.ash, days: SEED_DAYS, endMs: now, mlPerVisit: 30 }),
    ]);

    // Demo identities — one owner per household, proving tenant isolation.
    const ownerStmt = db.prepare(
      `INSERT INTO owners (id, email, display_name, household_id) VALUES (?, ?, ?, ?)`,
    );
    ownerStmt.run('owner_5001', 'peter@connectedcare.demo', 'Peter (Meeko & Lilo)', REF.householdId);
    ownerStmt.run('owner_6001', 'sam@connectedcare.demo', 'Sam (Duke & Ash)', REF2.householdId);

    // Baselines computed from the actual seeded telemetry, not hardcoded.
    for (const petId of [REF.meeko, REF.lilo, REF2.duke, REF2.ash]) {
      recomputeBaselines(db, petId, now);
    }
  })();
}

/** Wipes all tenant + reference data and reseeds. Reset is always pristine. */
export function resetAll(db: Db, now: number = Date.now()): void {
  db.transaction(() => {
    for (const table of [
      'owners', // references households; must go before it (no CASCADE)
      'orders', // references devices + households; must go before both (no CASCADE)
      'vet_shares', // references pets + households; must go before both (no CASCADE)
      'insights',
      'telemetry_events',
      'pet_baselines',
      'device_pet_links',
      'devices',
      'pets',
      'households',
      'environmental_context',
      'breed_profiles',
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  })();
  seedAll(db, now);
}
