import { Router } from 'express';
import { KNOWN_EVENT_TYPES, telemetryEnvelopeSchema } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { nowIso, uuid } from '../db/connection';
import { evaluateAfterEvent, type InsightListener } from '../engine/pipeline';
import { assertHousehold, deviceHousehold } from '../middleware/auth';
import { ApiError } from '../middleware/errors';
import { validate } from '../middleware/validate';

export function telemetryRoutes(db: Db, onInsight: InsightListener): Router {
  const r = Router();

  // The single ingestion envelope for every device type, current and future.
  r.post('/telemetry/events', validate(telemetryEnvelopeSchema), async (req, res, next) => {
    try {
      const { device_id, event_type, occurred_at, payload, schema_version } = req.body;

      const device = db
        .prepare(`SELECT id, household_id, device_type, deleted_at FROM devices WHERE id = ?`)
        .get(device_id) as { id: string; household_id: string; device_type: string; deleted_at: string | null } | undefined;
      if (!device) throw new ApiError(404, 'device_not_found', `No registered device with id ${device_id}.`);
      assertHousehold(req, device.household_id);
      if (device.deleted_at) throw new ApiError(409, 'device_deactivated', 'This device has been deactivated.');

      if (Date.parse(occurred_at) > Date.now() + 24 * 3600_000) {
        throw new ApiError(400, 'validation_error', 'occurred_at is more than 24 hours in the future.', [
          { path: 'occurred_at', message: 'timestamp too far in the future' },
        ]);
      }

      // Resolve pet attribution: explicit pet_id, else the single dedicated link.
      let petId: string | null = req.body.pet_id ?? null;
      if (!petId) {
        const links = db
          .prepare(`SELECT pet_id FROM device_pet_links WHERE device_id = ? AND unlinked_at IS NULL`)
          .all(device_id) as { pet_id: string }[];
        petId = links.length === 1 ? links[0].pet_id : null;
      }

      // Unknown event types are stored and flagged for schema review, never rejected.
      const known = (KNOWN_EVENT_TYPES as readonly string[]).includes(event_type);
      const flaggedReason = known ? null : `unrecognized event_type '${event_type}' — flagged for schema review`;

      const id = uuid();
      db.prepare(
        `INSERT INTO telemetry_events (id, household_id, device_id, pet_id, device_type, event_type, payload, schema_version, occurred_at, received_at, flagged_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        device.household_id,
        device_id,
        petId,
        device.device_type,
        event_type,
        JSON.stringify(payload),
        schema_version,
        new Date(occurred_at).toISOString(),
        nowIso(),
        flaggedReason,
      );

      // PRODUCTION NOTE: scoring consumes an async stream in production; the
      // demo scores synchronously for instant, deterministic feedback.
      const insights = known
        ? await evaluateAfterEvent(
            db,
            { household_id: device.household_id, device_id, pet_id: petId, event_type, payload },
            Date.now(),
            onInsight,
          )
        : [];

      res.status(201).json({
        data: { id, pet_id: petId, status: 'accepted', flagged_reason: flaggedReason, insights },
      });
    } catch (err) {
      next(err);
    }
  });

  r.get('/devices/:id/status', (req, res) => {
    assertHousehold(req, deviceHousehold(db, req.params.id));
    const device = db
      .prepare(`SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL`)
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!device) throw new ApiError(404, 'not_found', 'Device not found.');

    const lastPing = db
      .prepare(
        `SELECT payload, occurred_at FROM telemetry_events
         WHERE device_id = ? AND event_type = 'device_health_ping' ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get(req.params.id) as { payload: string; occurred_at: string } | undefined;
    const lastEvent = db
      .prepare(`SELECT occurred_at FROM telemetry_events WHERE device_id = ? ORDER BY occurred_at DESC LIMIT 1`)
      .get(req.params.id) as { occurred_at: string } | undefined;

    res.json({
      data: {
        ...device,
        last_seen: lastEvent?.occurred_at ?? null,
        last_health_ping: lastPing ? { ...JSON.parse(lastPing.payload), occurred_at: lastPing.occurred_at } : null,
      },
    });
  });

  return r;
}
