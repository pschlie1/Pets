import { Router } from 'express';
import type { Db } from '../db/connection';
import { ApiError } from '../middleware/errors';

function parseBreed(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, common_conditions: JSON.parse((row.common_conditions as string) ?? '[]') };
}

export function breedRoutes(db: Db): Router {
  const r = Router();

  r.get('/breeds', (req, res) => {
    const species = req.query.species as string | undefined;
    const rows = species
      ? db.prepare(`SELECT * FROM breed_profiles WHERE species = ? ORDER BY breed_name`).all(species)
      : db.prepare(`SELECT * FROM breed_profiles ORDER BY species, breed_name`).all();
    res.json({ data: (rows as Record<string, unknown>[]).map(parseBreed) });
  });

  r.get('/breeds/generic/:species', (req, res) => {
    const row = db
      .prepare(`SELECT * FROM breed_profiles WHERE species = ? AND is_generic_fallback = 1`)
      .get(req.params.species) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError(404, 'not_found', `No generic profile for species '${req.params.species}'.`);
    res.json({ data: parseBreed(row) });
  });

  r.get('/breeds/:id', (req, res) => {
    const row = db.prepare(`SELECT * FROM breed_profiles WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new ApiError(404, 'not_found', 'Breed profile not found.');
    res.json({ data: parseBreed(row) });
  });

  return r;
}
