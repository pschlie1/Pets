import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Briefing, Milestone, PeaceOfMindScore } from '@connected-care/shared';
import { buildApp } from '../app';
import { getDb, type Db } from '../db/connection';
import { REF, seedAll } from '../db/seed';

let app: Express;
let db: Db;
let AUTH: readonly ['Authorization', string] = ['Authorization', 'Bearer unset'];
let SAM: readonly ['Authorization', string] = ['Authorization', 'Bearer unset'];

const get = async <T>(path: string, auth = AUTH): Promise<{ status: number; data: T }> => {
  const res = await request(app).get(path).set(...auth);
  return { status: res.status, data: res.body.data as T };
};

beforeAll(async () => {
  db = getDb(':memory:');
  seedAll(db);
  app = buildApp(db).app;
  const peter = await request(app).post('/v1/auth/login').send({ email: 'peter@connectedcare.demo' });
  AUTH = ['Authorization', `Bearer ${peter.body.data.token}`] as const;
  const sam = await request(app).post('/v1/auth/login').send({ email: 'sam@connectedcare.demo' });
  SAM = ['Authorization', `Bearer ${sam.body.data.token}`] as const;
});

describe('daily briefing', () => {
  it('narrates the overnight picture from real facts (template mode offline)', async () => {
    const { status, data } = await get<Briefing>(`/v1/households/${REF.householdId}/briefing`);
    expect(status).toBe(200);
    expect(data.mode).toBe('template'); // no ANTHROPIC_API_KEY in tests
    expect(data.summary.length).toBeGreaterThan(30);
    expect(['morning', 'afternoon', 'evening']).toContain(data.greeting_period);
    // Fact chips cover both dogs and the fence.
    const text = data.facts.map((f) => f.text).join(' ');
    expect(text).toMatch(/Baxter/);
    expect(text).toMatch(/Wrigley/);
    expect(text).toMatch(/[Ff]ence|boundary/);
  });
});

describe('peace-of-mind score', () => {
  it('is high on the pristine seed and names the all-clear factor', async () => {
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    const { data } = await get<PeaceOfMindScore>(`/v1/households/${REF.householdId}/score`);
    expect(data.score).toBeGreaterThanOrEqual(90);
    expect(data.band).toBe('protected');
    expect(data.factors.length).toBeGreaterThan(0);
  });

  it('drops when an urgent insight lands and recovers on reset', async () => {
    await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/urgent_baxter_heart`)
      .set(...AUTH);
    const during = await get<PeaceOfMindScore>(`/v1/households/${REF.householdId}/score`);
    expect(during.data.score).toBeLessThanOrEqual(80);
    expect(during.data.factors.some((f) => f.delta < 0)).toBe(true);

    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    const after = await get<PeaceOfMindScore>(`/v1/households/${REF.householdId}/score`);
    expect(after.data.score).toBeGreaterThanOrEqual(90);
  });
});

describe('milestones', () => {
  it('celebrates the seeded record: walk streaks and a breach-free run', async () => {
    const { data } = await get<Milestone[]>(`/v1/households/${REF.householdId}/milestones`);
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThanOrEqual(4);
    // The pristine seed has no breaches, so the fence win must be present.
    expect(data.some((m) => m.icon === '🛡️')).toBe(true);
    for (const m of data) {
      expect(m.title.length).toBeGreaterThan(3);
      expect(m.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('tenancy', () => {
  it("rejects another household's engagement surfaces", async () => {
    for (const path of ['briefing', 'score', 'milestones']) {
      const res = await request(app).get(`/v1/households/${REF.householdId}/${path}`).set(...SAM);
      expect(res.status).toBe(403);
    }
  });
});
