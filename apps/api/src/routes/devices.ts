import { Router } from 'express';
import { doorSettingsSchema, type DoorActivity, type DoorSettings } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { uuid } from '../db/connection';
import { assertHousehold, deviceHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

/**
 * Device control: the "connected" half of connected products. Today that's
 * the smart door — lock/unlock and curfew ("control when it opens"). Every
 * settings change writes a door_status event so the audit trail lives in the
 * same telemetry record as everything else.
 */
export function deviceRoutes(db: Db): Router {
  const r = Router();

  r.patch('/devices/:id/settings', validate(doorSettingsSchema), (req, res) => {
    const householdId = deviceHousehold(db, req.params.id);
    assertHousehold(req, householdId);
    const device = db.prepare(`SELECT device_type FROM devices WHERE id = ?`).get(req.params.id) as {
      device_type: string;
    };
    if (device.device_type !== 'smart_door') {
      throw new ApiError(400, 'validation_error', 'Only smart doors have controllable settings today.');
    }

    const settings = req.body as DoorSettings;
    db.prepare(`UPDATE devices SET settings = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(settings),
      new Date().toISOString(),
      req.params.id,
    );
    const at = new Date().toISOString();
    db.prepare(
      `INSERT INTO telemetry_events (id, household_id, device_id, pet_id, device_type, event_type, payload, schema_version, occurred_at, received_at)
       VALUES (?, ?, ?, NULL, 'smart_door', 'door_status', ?, 1, ?, ?)`,
    ).run(
      uuid(),
      householdId,
      req.params.id,
      JSON.stringify({ ...settings, cause: 'owner_app' }),
      at,
      at,
    );
    res.json({ data: { device_id: req.params.id, settings } });
  });

  // The door log: who went in or out, when, plus the current settings.
  r.get('/households/:id/door-activity', (req, res) => {
    assertHousehold(req, req.params.id);
    const door = db
      .prepare(
        `SELECT id, settings FROM devices
         WHERE household_id = ? AND device_type = 'smart_door' AND deleted_at IS NULL LIMIT 1`,
      )
      .get(req.params.id) as { id: string; settings: string | null } | undefined;
    if (!door) throw new ApiError(404, 'not_found', 'No smart door in this household.');

    const hours = Number(req.query.hours ?? 24);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 21) {
      throw new ApiError(400, 'validation_error', 'hours must be between 1 and 504.');
    }
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const entries = (
      db
        .prepare(
          `SELECT te.occurred_at, te.pet_id, te.payload, p.name AS pet_name
           FROM telemetry_events te LEFT JOIN pets p ON p.id = te.pet_id
           WHERE te.device_id = ? AND te.event_type = 'door_passage' AND te.occurred_at >= ?
           ORDER BY te.occurred_at DESC LIMIT 100`,
        )
        .all(door.id, since) as { occurred_at: string; pet_id: string | null; payload: string; pet_name: string | null }[]
    ).map((row) => {
      const p = JSON.parse(row.payload) as { direction?: 'in' | 'out' };
      return {
        occurred_at: row.occurred_at,
        pet_id: row.pet_id,
        pet_name: row.pet_name,
        direction: p.direction ?? 'out',
      };
    });

    const activity: DoorActivity = {
      household_id: req.params.id,
      device_id: door.id,
      settings: door.settings
        ? (JSON.parse(door.settings) as DoorSettings)
        : { locked: false, curfew_start: null, curfew_end: null },
      entries,
    };
    res.json({ data: activity });
  });

  return r;
}
