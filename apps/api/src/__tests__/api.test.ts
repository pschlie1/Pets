import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../app';
import { getDb } from '../db/connection';
import { REF, seedAll } from '../db/seed';

let app: Express;
let AUTH: readonly ['Authorization', string] = ['Authorization', 'Bearer unset'];

beforeAll(async () => {
  const db = getDb(':memory:');
  seedAll(db);
  app = buildApp(db).app;
  const login = await request(app).post('/v1/auth/login').send({ email: 'peter@connectedcare.demo' });
  AUTH = ['Authorization', `Bearer ${login.body.data.token}`] as const;
});

describe('api documentation', () => {
  it('serves interactive docs without auth', async () => {
    const res = await request(app).get('/docs');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/swagger-ui/);
  });

  it('serves the OpenAPI spec', async () => {
    const res = await request(app).get('/docs/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/openapi: 3\.1/);
    expect(res.text).toMatch(/\/v1\/telemetry\/events/);
  });
});

describe('auth', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await request(app).get(`/v1/households/${REF.householdId}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });
});

describe('telemetry ingestion', () => {
  it('accepts a well-formed envelope and returns pet attribution', async () => {
    const res = await request(app)
      .post('/v1/telemetry/events')
      .set(...AUTH)
      .send({
        device_id: REF.baxterCollar,
        event_type: 'heart_rate_reading',
        occurred_at: new Date().toISOString(),
        payload: { bpm: 98, activity_state: 'resting', boundary_status: 'inside' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.pet_id).toBe(REF.baxter);
    expect(res.body.data.status).toBe('accepted');
  });

  it('returns 400 with the specific validation failure for a malformed payload', async () => {
    const res = await request(app)
      .post('/v1/telemetry/events')
      .set(...AUTH)
      .send({ event_type: 'heart_rate_reading', occurred_at: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toContain('device_id');
    expect(paths).toContain('occurred_at');
  });

  it('rejects occurred_at more than 24h in the future', async () => {
    const res = await request(app)
      .post('/v1/telemetry/events')
      .set(...AUTH)
      .send({
        device_id: REF.baxterCollar,
        event_type: 'heart_rate_reading',
        occurred_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
        payload: { bpm: 98 },
      });
    expect(res.status).toBe(400);
  });

  it('stores and flags an unknown event_type instead of rejecting it', async () => {
    const res = await request(app)
      .post('/v1/telemetry/events')
      .set(...AUTH)
      .send({
        device_id: REF.feeder,
        event_type: 'quantum_snack_event',
        occurred_at: new Date().toISOString(),
        payload: { snacks: 3 },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.flagged_reason).toMatch(/schema review/);
  });

  it('404s for an unregistered device', async () => {
    const res = await request(app)
      .post('/v1/telemetry/events')
      .set(...AUTH)
      .send({ device_id: 'dev_ghost', event_type: 'heart_rate_reading', occurred_at: new Date().toISOString() });
    expect(res.status).toBe(404);
  });
});

describe('breeds and reference data', () => {
  it('lists breeds by species and serves the generic fallback', async () => {
    const dogs = await request(app).get('/v1/breeds?species=dog').set(...AUTH);
    expect(dogs.status).toBe(200);
    expect(dogs.body.data.length).toBeGreaterThanOrEqual(3);

    const generic = await request(app).get('/v1/breeds/generic/dog').set(...AUTH);
    expect(generic.body.data.is_generic_fallback).toBe(1);
  });
});

describe('pets and baselines', () => {
  it('serves a pet with breed profile and linked devices', async () => {
    const res = await request(app).get(`/v1/pets/${REF.baxter}`).set(...AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Baxter');
    expect(res.body.data.breed_name).toMatch(/Cavalier/);
    expect(res.body.data.devices.length).toBe(3); // collar + shared feeder + shared fountain
  });

  it('computes established baselines from seeded telemetry', async () => {
    const res = await request(app).get(`/v1/pets/${REF.baxter}/baseline?metric=resting_heart_rate`).set(...AUTH);
    const baseline = res.body.data[0];
    expect(baseline.status).toBe('established');
    expect(baseline.mean).toBeGreaterThan(85);
    expect(baseline.mean).toBeLessThan(105);
  });

  it('falls back to the species-generic profile for an unlisted breed', async () => {
    const res = await request(app)
      .post(`/v1/households/${REF.householdId}/pets`)
      .set(...AUTH)
      .send({ name: 'Nugget', species: 'dog' });
    expect(res.status).toBe(201);
    expect(res.body.data.breed_reference_confidence).toBe('low');
    expect(res.body.data.breed_id).toBeTruthy();
  });
});

describe('demo tier → insight pipeline (full stack, template narration)', () => {
  it('trigger S5 produces an urgent heart-rate insight with a vet recommendation', async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/urgent_baxter_heart`)
      .set(...AUTH);
    expect(res.status).toBe(200);
    const hr = res.body.data.insights.find((i: { metric: string }) => i.metric === 'resting_heart_rate');
    expect(hr.urgency).toBe('urgent');
    expect(hr.recommended_action.toLowerCase()).toMatch(/vet/);
  });

  it('trigger S6 produces a routed emergency', async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/emergency_boundary_breach`)
      .set(...AUTH);
    const insight = res.body.data.insights[0];
    expect(insight.urgency).toBe('emergency');
    expect(insight.routed_to_associate).toBe(1);
  });

  it('household rollup paginates and includes the generated insights', async () => {
    const res = await request(app)
      .get(`/v1/households/${REF.householdId}/insights?limit=1&page=1`)
      .set(...AUTH);
    expect(res.body.data.length).toBe(1);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination.total_pages).toBe(res.body.pagination.total);
  });

  it('companion agent answers grounded in household data (template mode)', async () => {
    const res = await request(app)
      .post('/v1/agent/query')
      .set(...AUTH)
      .send({ pet_id: REF.baxter, question: 'How is Baxter doing?' });
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('template');
    expect(res.body.data.answer).toMatch(/Baxter/);
    // An urgent insight is active from S5 — the guardrail requires a vet mention.
    expect(res.body.data.answer.toLowerCase()).toMatch(/vet/);
  });

  it('companion agent declines medication questions outright', async () => {
    const res = await request(app)
      .post('/v1/agent/query')
      .set(...AUTH)
      .send({ pet_id: REF.baxter, question: 'How many mg of benadryl can I give him?' });
    expect(res.body.data.answer).toMatch(/veterinarian/i);
    expect(res.body.data.answer).not.toMatch(/\d+\s*mg/);
  });

  it('acknowledge and dismiss walk the insight state machine', async () => {
    const list = await request(app).get(`/v1/households/${REF.householdId}/insights`).set(...AUTH);
    const [a, b] = list.body.data;
    const ack = await request(app).post(`/v1/insights/${a.id}/acknowledge`).set(...AUTH);
    expect(ack.body.data.acknowledged_status).toBe('acknowledged');
    const dis = await request(app).post(`/v1/insights/${b.id}/dismiss`).set(...AUTH);
    expect(dis.body.data.acknowledged_status).toBe('dismissed');
  });

  it('reset restores a pristine household', async () => {
    const res = await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    expect(res.status).toBe(200);
    const insights = await request(app).get(`/v1/households/${REF.householdId}/insights`).set(...AUTH);
    expect(insights.body.pagination.total).toBe(0);
  });
});

describe('vet report', () => {
  it('assembles the full report with template-mode summary', async () => {
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    const res = await request(app).get(`/v1/pets/${REF.baxter}/vet-report`).set(...AUTH);
    expect(res.status).toBe(200);
    const report = res.body.data;
    expect(report.pet.name).toBe('Baxter');
    expect(report.metrics.length).toBe(5);
    expect(report.summary.mode).toBe('template');
    expect(report.summary.text).toMatch(/14 days/);
    expect(report.summary.text).toMatch(/not a diagnosis/);
    expect(report.breed.common_conditions.length).toBeGreaterThan(0);
    expect(report.shares).toEqual([]);
  });

  it('404s for an unknown pet', async () => {
    const res = await request(app).get('/v1/pets/pet_ghost/vet-report').set(...AUTH);
    expect(res.status).toBe(404);
  });

  it('records a digital share and returns it in subsequent reports', async () => {
    const share = await request(app)
      .post(`/v1/pets/${REF.baxter}/vet-report/share`)
      .set(...AUTH)
      .send({ recipient: 'Lincoln Park Veterinary Clinic', method: 'portal' });
    expect(share.status).toBe(201);
    expect(share.body.data.recipient).toBe('Lincoln Park Veterinary Clinic');
    expect(Array.isArray(share.body.data.insight_ids)).toBe(true);
    expect(share.body.data.shared_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const report = await request(app).get(`/v1/pets/${REF.baxter}/vet-report`).set(...AUTH);
    expect(report.body.data.shares.length).toBe(1);
    expect(report.body.data.shares[0].method).toBe('portal');
  });

  it('rejects a malformed share request', async () => {
    const res = await request(app)
      .post(`/v1/pets/${REF.baxter}/vet-report/share`)
      .set(...AUTH)
      .send({ method: 'carrier_pigeon' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('excludes dismissed insights from the report, keeps acknowledged ones', async () => {
    const trigger = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/urgent_baxter_heart`)
      .set(...AUTH);
    const insights = trigger.body.data.insights as { id: string; urgency: string }[];
    const urgent = insights.find((i) => i.urgency === 'urgent')!;
    const other = insights.find((i) => i.id !== urgent.id);

    await request(app).post(`/v1/insights/${urgent.id}/dismiss`).set(...AUTH);
    if (other) await request(app).post(`/v1/insights/${other.id}/acknowledge`).set(...AUTH);

    const report = await request(app).get(`/v1/pets/${REF.baxter}/vet-report`).set(...AUTH);
    const ids = report.body.data.active_insights.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(urgent.id);
    if (other) expect(ids).toContain(other.id);
  });

  it('reset clears share history', async () => {
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    const report = await request(app).get(`/v1/pets/${REF.baxter}/vet-report`).set(...AUTH);
    expect(report.body.data.shares).toEqual([]);
  });
});

describe('containment (Safety Center)', () => {
  const getContainment = () => request(app).get(`/v1/households/${REF.householdId}/containment`).set(...AUTH);

  it('lists the three containment scenarios in the demo catalog', async () => {
    const res = await request(app).get('/v1/demo/scenarios').set(...AUTH);
    const keys = res.body.data.map((s: { key: string }) => s.key);
    expect(keys).toContain('breach_safe_return');
    expect(keys).toContain('collar_signal_lost');
    expect(keys).toContain('collar_battery_critical');
  });

  it('reports both pets protected with fresh check-ins after reset (top-up works)', async () => {
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    const res = await getContainment();
    expect(res.status).toBe(200);
    expect(res.body.data.overall).toBe('all_safe');
    expect(res.body.data.boundary.polygon.length).toBeGreaterThanOrEqual(6);
    for (const pet of res.body.data.pets) {
      expect(pet.containment_state).toBe('protected');
      expect(pet.zone_status).toBe('inside');
      expect(pet.minutes_since_check_in).toBeLessThan(20);
      expect(pet.last_position).toBeTruthy();
    }
  });

  it('safe-return scenario yields a monitor insight and the pet ends up back inside', async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/breach_safe_return`)
      .set(...AUTH);
    expect(res.body.data.insights[0].urgency).toBe('monitor');
    expect(res.body.data.insights[0].insight_type).toBe('pet_safety');
    const containment = await getContainment();
    const baxter = containment.body.data.pets.find((p: { pet_id: string }) => p.pet_id === REF.baxter);
    expect(baxter.zone_status).toBe('inside');
  });

  it('signal-lost scenario yields an attention insight, offline device, unknown zone', async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/collar_signal_lost`)
      .set(...AUTH);
    expect(res.body.data.insights[0].urgency).toBe('attention');
    expect(res.body.data.insights[0].metric).toBe('containment_signal');
    const containment = await getContainment();
    const wrigley = containment.body.data.pets.find((p: { pet_id: string }) => p.pet_id === REF.wrigley);
    expect(wrigley.device_status).toBe('offline');
    expect(wrigley.zone_status).toBe('unknown');
    expect(wrigley.containment_state).toBe('signal_lost');
    expect(containment.body.data.overall).toBe('degraded');
  });

  it('battery-critical scenario yields an urgent safety-gap insight and low_battery device', async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/collar_battery_critical`)
      .set(...AUTH);
    expect(res.body.data.insights[0].urgency).toBe('urgent');
    expect(res.body.data.insights[0].insight_type).toBe('equipment');
    const containment = await getContainment();
    const baxter = containment.body.data.pets.find((p: { pet_id: string }) => p.pet_id === REF.baxter);
    expect(baxter.battery_pct).toBe(12);
    expect(baxter.device_status).toBe('low_battery');
  });

  it('emergency breach pins the pet outside and the top-up does not erase it', async () => {
    await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/emergency_boundary_breach`)
      .set(...AUTH);
    // Two consecutive reads: the breach state must survive the lazy top-up.
    await getContainment();
    const containment = await getContainment();
    const wrigley = containment.body.data.pets.find((p: { pet_id: string }) => p.pet_id === REF.wrigley);
    expect(wrigley.zone_status).toBe('outside');
    expect(wrigley.containment_state).toBe('breach');
    expect(containment.body.data.overall).toBe('alert');
    const kinds = containment.body.data.recent_events.map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('breach');
  });

  it('reset returns containment to all_safe', async () => {
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    const res = await getContainment();
    expect(res.body.data.overall).toBe('all_safe');
  });
});
