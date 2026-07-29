import { Router } from 'express';
import { createHouseholdSchema, createPetSchema, linkDeviceSchema, patchPetSchema } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { dailyMetricSeries, PET_METRICS, type PetMetric } from '../engine/aggregates';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

export function householdRoutes(db: Db): Router {
  const r = Router();

  r.post('/households', validate(createHouseholdSchema), (req, res) => {
    const id = uuid();
    db.prepare(
      `INSERT INTO households (id, location_city, location_state, location_zip, climate_zone) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, req.body.location_city, req.body.location_state, req.body.location_zip, req.body.climate_zone ?? null);
    res.status(201).json({ data: db.prepare(`SELECT * FROM households WHERE id = ?`).get(id) });
  });

  r.get('/households/:id', (req, res) => {
    const household = db
      .prepare(`SELECT * FROM households WHERE id = ? AND deleted_at IS NULL`)
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!household) throw new ApiError(404, 'not_found', 'Household not found.');
    const pets = db
      .prepare(`SELECT * FROM pets WHERE household_id = ? AND deleted_at IS NULL ORDER BY name`)
      .all(req.params.id);
    const devices = db
      .prepare(`SELECT * FROM devices WHERE household_id = ? AND deleted_at IS NULL`)
      .all(req.params.id);
    res.json({ data: { ...household, pets, devices } });
  });

  r.post('/households/:id/pets', validate(createPetSchema), (req, res) => {
    const household = db.prepare(`SELECT id FROM households WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
    if (!household) throw new ApiError(404, 'not_found', 'Household not found.');

    // Breed fallback (PRD §4.4): no breed match → species generic profile, low confidence.
    let breedId = req.body.breed_id ?? null;
    let confidence = 'low';
    if (breedId) {
      const breed = db.prepare(`SELECT id, is_generic_fallback FROM breed_profiles WHERE id = ?`).get(breedId) as
        | { id: string; is_generic_fallback: number }
        | undefined;
      if (!breed) throw new ApiError(400, 'unknown_breed', 'breed_id does not match a breed profile.');
      confidence = breed.is_generic_fallback ? 'low' : 'high';
    } else {
      const generic = db
        .prepare(`SELECT id FROM breed_profiles WHERE species = ? AND is_generic_fallback = 1`)
        .get(req.body.species) as { id: string } | undefined;
      breedId = generic?.id ?? null;
    }

    const id = uuid();
    db.prepare(
      `INSERT INTO pets (id, household_id, name, species, breed_id, breed_reference_confidence, date_of_birth, weight_lbs, sex)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.params.id,
      req.body.name,
      req.body.species,
      breedId,
      confidence,
      req.body.date_of_birth ?? null,
      req.body.weight_lbs ?? null,
      req.body.sex ?? null,
    );
    res.status(201).json({ data: db.prepare(`SELECT * FROM pets WHERE id = ?`).get(id) });
  });

  r.get('/pets/:id', (req, res) => {
    const pet = db
      .prepare(
        `SELECT p.*, b.breed_name, b.size_class, b.resting_hr_low, b.resting_hr_high, b.common_conditions, b.is_generic_fallback
         FROM pets p LEFT JOIN breed_profiles b ON b.id = p.breed_id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
      )
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!pet) throw new ApiError(404, 'not_found', 'Pet not found.');
    pet.common_conditions = JSON.parse((pet.common_conditions as string) ?? '[]');
    const devices = db
      .prepare(
        `SELECT d.* FROM devices d JOIN device_pet_links l ON l.device_id = d.id
         WHERE l.pet_id = ? AND l.unlinked_at IS NULL AND d.deleted_at IS NULL`,
      )
      .all(req.params.id);
    res.json({ data: { ...pet, devices } });
  });

  r.patch('/pets/:id', validate(patchPetSchema), (req, res) => {
    const pet = db.prepare(`SELECT id FROM pets WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
    if (!pet) throw new ApiError(404, 'not_found', 'Pet not found.');
    const fields = ['name', 'species', 'breed_id', 'date_of_birth', 'weight_lbs', 'sex'] as const;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        db.prepare(`UPDATE pets SET ${f} = ?, updated_at = ? WHERE id = ?`).run(
          req.body[f],
          new Date().toISOString(),
          req.params.id,
        );
      }
    }
    res.json({ data: db.prepare(`SELECT * FROM pets WHERE id = ?`).get(req.params.id) });
  });

  r.post('/pets/:id/devices', validate(linkDeviceSchema), (req, res) => {
    const pet = db.prepare(`SELECT id FROM pets WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
    if (!pet) throw new ApiError(404, 'not_found', 'Pet not found.');
    const device = db.prepare(`SELECT id FROM devices WHERE id = ? AND deleted_at IS NULL`).get(req.body.device_id);
    if (!device) throw new ApiError(404, 'not_found', 'Device not found.');
    db.prepare(`INSERT INTO device_pet_links (id, device_id, pet_id) VALUES (?, ?, ?)`).run(
      uuid(),
      req.body.device_id,
      req.params.id,
    );
    res.status(201).json({ data: { device_id: req.body.device_id, pet_id: req.params.id, linked: true } });
  });

  // Daily metric series for trend sparklines: rolling 24h buckets, oldest first.
  r.get('/pets/:id/metrics', (req, res) => {
    const metric = req.query.metric as PetMetric;
    if (!(PET_METRICS as readonly string[]).includes(metric)) {
      throw new ApiError(400, 'validation_error', `metric must be one of: ${PET_METRICS.join(', ')}`);
    }
    const days = Math.min(Math.max(parseInt((req.query.days as string) ?? '14', 10) || 14, 1), 30);
    const now = Date.now();
    const series = dailyMetricSeries(db, req.params.id, metric, new Date(now - days * 86_400_000).toISOString(), now);
    const baseline = db
      .prepare(`SELECT mean, stdev, status FROM pet_baselines WHERE pet_id = ? AND metric = ?`)
      .get(req.params.id, metric);
    const points = [...series.entries()]
      .sort(([a], [b]) => b - a)
      .map(([daysAgo, value]) => ({ days_ago: daysAgo, value: Math.round(value * 10) / 10 }));
    res.json({ data: { metric, points, baseline: baseline ?? null } });
  });

  r.get('/pets/:id/baseline', (req, res) => {
    const metric = req.query.metric as string | undefined;
    const rows = metric
      ? db.prepare(`SELECT * FROM pet_baselines WHERE pet_id = ? AND metric = ?`).all(req.params.id, metric)
      : db.prepare(`SELECT * FROM pet_baselines WHERE pet_id = ?`).all(req.params.id);
    res.json({ data: rows });
  });

  return r;
}
