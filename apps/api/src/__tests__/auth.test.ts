import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { buildApp } from '../app';
import { getDb } from '../db/connection';
import { REF, REF2, seedAll } from '../db/seed';
import { signToken } from '../auth/tokens';

let app: Express;
let peter: string;
let sam: string;

async function login(email: string): Promise<string> {
  const res = await request(app).post('/v1/auth/login').send({ email });
  return res.body.data.token;
}

beforeAll(async () => {
  const db = getDb(':memory:');
  seedAll(db);
  app = buildApp(db).app;
  peter = await login('peter@connectedcare.demo');
  sam = await login('sam@connectedcare.demo');
});

describe('authentication', () => {
  it('login returns a token bound to the owner household', async () => {
    const res = await request(app).post('/v1/auth/login').send({ email: 'peter@connectedcare.demo' });
    expect(res.status).toBe(201);
    expect(res.body.data.owner.household_id).toBe(REF.householdId);
    expect(res.body.data.token.split('.').length).toBe(3);
  });

  it('rejects unknown identities', async () => {
    const res = await request(app).post('/v1/auth/login').send({ email: 'stranger@example.com' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unknown_owner');
  });

  it('rejects requests without a token', async () => {
    const res = await request(app).get(`/v1/households/${REF.householdId}`);
    expect(res.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const [h, p] = peter.split('.');
    const res = await request(app)
      .get(`/v1/households/${REF.householdId}`)
      .set('Authorization', `Bearer ${h}.${p}.AAAAtampered`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const expired = signToken(
      { sub: 'owner_5001', email: 'peter@connectedcare.demo', name: 'Peter', household_id: REF.householdId },
      -60,
    );
    const res = await request(app).get(`/v1/households/${REF.householdId}`).set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('auth/me returns the owner for a valid token', async () => {
    const res = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${sam}`);
    expect(res.body.data.household_id).toBe(REF2.householdId);
  });
});

describe('tenant isolation — one identity can never reach another household', () => {
  const asPeter = (path: string) => request(app).get(path).set('Authorization', `Bearer ${peter}`);
  const asSam = (path: string) => request(app).get(path).set('Authorization', `Bearer ${sam}`);

  it("blocks reading another household's record and rollup", async () => {
    expect((await asPeter(`/v1/households/${REF2.householdId}`)).status).toBe(403);
    expect((await asSam(`/v1/households/${REF.householdId}/insights`)).status).toBe(403);
    expect((await asSam(`/v1/households/${REF.householdId}/containment`)).status).toBe(403);
  });

  it("blocks reading another household's pet, metrics, and vet report", async () => {
    expect((await asSam(`/v1/pets/${REF.meeko}`)).status).toBe(403);
    expect((await asSam(`/v1/pets/${REF.meeko}/metrics?metric=resting_heart_rate`)).status).toBe(403);
    expect((await asSam(`/v1/pets/${REF.meeko}/vet-report`)).status).toBe(403);
    expect((await asPeter(`/v1/pets/${REF2.duke}`)).status).toBe(403);
  });

  it("blocks posting telemetry to another household's device", async () => {
    const res = await request(app)
      .post('/v1/telemetry/events')
      .set('Authorization', `Bearer ${sam}`)
      .send({
        device_id: REF.meekoCollar,
        event_type: 'heart_rate_reading',
        occurred_at: new Date().toISOString(),
        payload: { bpm: 200 },
      });
    expect(res.status).toBe(403);
  });

  it("blocks acting on another household's insight", async () => {
    const trigger = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/urgent_meeko_heart`)
      .set('Authorization', `Bearer ${peter}`);
    const insightId = trigger.body.data.insights[0].id;
    const res = await request(app).post(`/v1/insights/${insightId}/dismiss`).set('Authorization', `Bearer ${sam}`);
    expect(res.status).toBe(403);
  });

  it('blocks the companion agent across tenants', async () => {
    const res = await request(app)
      .post('/v1/agent/query')
      .set('Authorization', `Bearer ${sam}`)
      .send({ pet_id: REF.meeko, question: 'How is Meeko?' });
    expect(res.status).toBe(403);
  });

  it('restricts demo scenario controls to the reference household owner', async () => {
    const res = await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/info_water_dip`)
      .set('Authorization', `Bearer ${sam}`);
    expect(res.status).toBe(403);
  });

  it('SSE stream requires a matching token and rejects cross-household paths', async () => {
    expect((await request(app).get(`/v1/households/${REF.householdId}/stream`)).status).toBe(401);
    const cross = await request(app).get(`/v1/households/${REF.householdId}/stream?token=${sam}`);
    expect(cross.status).toBe(403);
  });

  it("each identity sees only its own data", async () => {
    const peterHh = await asPeter(`/v1/households/${REF.householdId}`);
    expect(peterHh.body.data.pets.map((p: { name: string }) => p.name).sort()).toEqual(['Lilo', 'Meeko']);
    const samHh = await asSam(`/v1/households/${REF2.householdId}`);
    expect(samHh.body.data.pets.map((p: { name: string }) => p.name).sort()).toEqual(['Ash', 'Duke']);
  });

  it('serves profile photos only to the owning household', async () => {
    // No token → 401; wrong household → 403; owner → JPEG bytes.
    expect((await request(app).get(`/v1/pets/${REF.meeko}/photo`)).status).toBe(401);
    expect((await asSam(`/v1/pets/${REF.meeko}/photo`)).status).toBe(403);
    const ok = await asPeter(`/v1/pets/${REF.meeko}/photo`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.body.length).toBeGreaterThan(10_000);
    // Query-parameter token works too (how <img> tags authenticate).
    expect((await request(app).get(`/v1/pets/${REF.meeko}/photo?token=${peter}`)).status).toBe(200);
    // A pet with no photo 404s cleanly.
    expect((await asSam(`/v1/pets/${REF2.duke}/photo`)).status).toBe(404);
    // The household payload flags who has a photo — never the bytes.
    const hh = await asPeter(`/v1/households/${REF.householdId}`);
    for (const pet of hh.body.data.pets as { has_photo: number; photo?: unknown }[]) {
      expect(pet.has_photo).toBe(1);
      expect(pet.photo).toBeUndefined();
    }
  });
});
