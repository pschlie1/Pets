import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../app';
import { getDb } from '../db/connection';
import { REF, seedAll } from '../db/seed';

const AUTH = ['Authorization', 'Bearer test-token'] as const;

let app: Express;

beforeAll(() => {
  const db = getDb(':memory:');
  seedAll(db);
  app = buildApp(db).app;
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
