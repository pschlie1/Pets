import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DoorActivity, EcosystemLine, Insight } from '@connected-care/shared';
import { buildApp } from '../app';
import { getDb, type Db } from '../db/connection';
import { REF, seedAll } from '../db/seed';

let app: Express;
let db: Db;
let AUTH: readonly ['Authorization', string] = ['Authorization', 'Bearer unset'];
let SAM: readonly ['Authorization', string] = ['Authorization', 'Bearer unset'];

beforeAll(async () => {
  db = getDb(':memory:');
  seedAll(db);
  app = buildApp(db).app;
  const peter = await request(app).post('/v1/auth/login').send({ email: 'peter@connectedcare.demo' });
  AUTH = ['Authorization', `Bearer ${peter.body.data.token}`] as const;
  const sam = await request(app).post('/v1/auth/login').send({ email: 'sam@connectedcare.demo' });
  SAM = ['Authorization', `Bearer ${sam.body.data.token}`] as const;
});

describe('the household now spans dogs and a cat', () => {
  it('Stitch is seeded with litter, feeder, fountain, and door links', async () => {
    const res = await request(app).get(`/v1/pets/${REF.stitch}`).set(...AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Stitch');
    expect(res.body.data.species).toBe('cat');
    const types = (res.body.data.devices as { device_type: string }[]).map((d) => d.device_type).sort();
    expect(types).toEqual(['feeder', 'fountain', 'litter_box', 'smart_door']);
  });

  it("serves Stitch's litter-visit trend with an established baseline", async () => {
    const res = await request(app)
      .get(`/v1/pets/${REF.stitch}/metrics?metric=litter_visits_per_day&days=14`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.points.length).toBeGreaterThan(10);
    expect(res.body.data.baseline.status).toBe('established');
    expect(res.body.data.baseline.mean).toBeGreaterThan(2);
    expect(res.body.data.baseline.mean).toBeLessThan(5);
  });
});

describe('smart door — control when it opens', () => {
  it('locks, sets a curfew, and records a door_status audit event', async () => {
    const res = await request(app)
      .patch(`/v1/devices/${REF.door}/settings`)
      .set(...AUTH)
      .send({ locked: true, curfew_start: '21:00', curfew_end: '07:00' });
    expect(res.status).toBe(200);
    expect(res.body.data.settings.locked).toBe(true);

    const audit = db
      .prepare(
        `SELECT payload FROM telemetry_events WHERE device_id = ? AND event_type = 'door_status' ORDER BY occurred_at DESC LIMIT 1`,
      )
      .get(REF.door) as { payload: string };
    expect(JSON.parse(audit.payload).locked).toBe(true);

    // Restore the seeded settings.
    await request(app)
      .patch(`/v1/devices/${REF.door}/settings`)
      .set(...AUTH)
      .send({ locked: false, curfew_start: '22:00', curfew_end: '06:00' });
  });

  it('rejects settings on a non-door device and malformed curfews', async () => {
    const wrongDevice = await request(app)
      .patch(`/v1/devices/${REF.fountain}/settings`)
      .set(...AUTH)
      .send({ locked: true, curfew_start: null, curfew_end: null });
    expect(wrongDevice.status).toBe(400);

    const badTime = await request(app)
      .patch(`/v1/devices/${REF.door}/settings`)
      .set(...AUTH)
      .send({ locked: false, curfew_start: '25:99', curfew_end: '06:00' });
    expect(badTime.status).toBe(400);

    const halfCurfew = await request(app)
      .patch(`/v1/devices/${REF.door}/settings`)
      .set(...AUTH)
      .send({ locked: false, curfew_start: '22:00', curfew_end: null });
    expect(halfCurfew.status).toBe(400);
  });

  it('serves the comings & goings log with pet attribution', async () => {
    const res = await request(app)
      .get(`/v1/households/${REF.householdId}/door-activity?hours=504`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    const activity = res.body.data as DoorActivity;
    expect(activity.settings.curfew_start).toBe('22:00');
    expect(activity.entries.length).toBeGreaterThan(10);
    const names = new Set(activity.entries.map((e) => e.pet_name));
    expect(names.has('Meeko') || names.has('Lilo')).toBe(true);
    for (const e of activity.entries) expect(['in', 'out']).toContain(e.direction);
  });

  it('door ingestion flows through the standard telemetry envelope', async () => {
    const res = await request(app)
      .post('/v1/telemetry/events')
      .set(...AUTH)
      .send({
        device_id: REF.door,
        event_type: 'door_passage',
        occurred_at: new Date().toISOString(),
        pet_id: REF.stitch,
        payload: { direction: 'out', method: 'collar_tag' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('accepted');
    expect(res.body.data.flagged_reason).toBeNull();
  });
});

describe('new-scenario pipeline', () => {
  it('raccoon lockout → attention pet_safety insight, door locked in the record', async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/door_raccoon_lockout`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    const insights = res.body.data.insights as Insight[];
    expect(insights).toHaveLength(1);
    expect(insights[0].insight_type).toBe('pet_safety');
    expect(insights[0].urgency).toBe('attention');
    expect(insights[0].summary).toMatch(/raccoon/i);
    expect(insights[0].summary).toMatch(/locked/i);
  });

  it("litter spike → urgent pet_health insight for Stitch with a vet recommendation", async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/litter_visits_spike`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    const insights = res.body.data.insights as Insight[];
    expect(insights).toHaveLength(1);
    expect(insights[0].pet_id).toBe(REF.stitch);
    expect(insights[0].insight_type).toBe('pet_health');
    expect(insights[0].urgency).toBe('urgent');
    expect(insights[0].recommended_action).toMatch(/vet/i);
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
  });
});

describe('ecosystem catalog', () => {
  it('is public and pairs live lines with device types', async () => {
    const res = await request(app).get('/v1/ecosystem');
    expect(res.status).toBe(200);
    const lines = res.body.data as EcosystemLine[];
    expect(lines.length).toBeGreaterThan(10);
    const live = lines.filter((l) => l.status === 'live');
    expect(live.every((l) => l.device_type !== null)).toBe(true);
    expect(live.map((l) => l.device_type)).toContain('smart_door');
    expect(live.map((l) => l.device_type)).toContain('litter_box');
    expect(lines.some((l) => l.status === 'coming_soon')).toBe(true);
  });
});

describe('tenancy', () => {
  it("rejects another household's door controls and log", async () => {
    const patch = await request(app)
      .patch(`/v1/devices/${REF.door}/settings`)
      .set(...SAM)
      .send({ locked: true, curfew_start: null, curfew_end: null });
    expect(patch.status).toBe(403);
    const log = await request(app).get(`/v1/households/${REF.householdId}/door-activity`).set(...SAM);
    expect(log.status).toBe(403);
  });
});
