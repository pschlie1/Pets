import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type {
  Briefing,
  DealerStatus,
  Milestone,
  Order,
  PeaceOfMindScore,
  VetShareWithStatus,
} from '@connected-care/shared';
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

describe('replenishment orders', () => {
  it('places a matching consumable order with an ETA, then lists it', async () => {
    const res = await request(app)
      .post('/v1/orders')
      .set(...AUTH)
      .send({ device_id: REF.fountain, sku: 'filt-std-4pk' });
    expect(res.status).toBe(201);
    const order = res.body.data as Order;
    expect(order.label).toMatch(/filter/i);
    expect(order.price_cents).toBe(1299);
    expect(order.eta_date > new Date().toISOString().slice(0, 10)).toBe(true);

    const list = await get<Order[]>(`/v1/households/${REF.householdId}/orders`);
    expect(list.data.some((o) => o.id === order.id)).toBe(true);
  });

  it('rejects a sku that does not fit the device', async () => {
    const res = await request(app)
      .post('/v1/orders')
      .set(...AUTH)
      .send({ device_id: REF.fountain, sku: 'batt-rfa-67' });
    expect(res.status).toBe(400);
  });

  it("rejects orders against another household's device", async () => {
    const res = await request(app)
      .post('/v1/orders')
      .set(...SAM)
      .send({ device_id: REF.fountain, sku: 'filt-std-4pk' });
    expect(res.status).toBe(403);
  });
});

describe('dealer', () => {
  it('returns the household dealer with no dispatch when calm', async () => {
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
    const { data } = await get<DealerStatus>(`/v1/households/${REF.householdId}/dealer`);
    expect(data.dealer?.name).toMatch(/Invisible Fence/);
    expect(data.dispatch).toBeNull();
  });

  it('shows live dispatch after an emergency routes to the associate', async () => {
    await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/emergency_boundary_breach`)
      .set(...AUTH);
    const { data } = await get<DealerStatus>(`/v1/households/${REF.householdId}/dealer`);
    expect(data.dispatch).not.toBeNull();
    expect(data.dispatch!.step).toBe('alerted'); // just routed
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
  });
});

describe('vet share stages', () => {
  it('a fresh share starts at sent; an old one is reviewed with a clinic note', async () => {
    await request(app)
      .post(`/v1/pets/${REF.baxter}/vet-report/share`)
      .set(...AUTH)
      .send({ recipient: 'Lincoln Park Veterinary Clinic', method: 'portal' });
    // Backdate a second share so the reviewed stage is exercised.
    db.prepare(
      `INSERT INTO vet_shares (id, household_id, pet_id, recipient, method, insight_ids, shared_at) VALUES (?, ?, ?, ?, 'portal', '[]', ?)`,
    ).run('share_old', REF.householdId, REF.baxter, 'Lincoln Park Veterinary Clinic', new Date(Date.now() - 20 * 60_000).toISOString());

    const { data } = await get<VetShareWithStatus[]>(`/v1/pets/${REF.baxter}/vet-report/shares`);
    const fresh = data.find((s) => s.id !== 'share_old')!;
    const old = data.find((s) => s.id === 'share_old')!;
    expect(fresh.stage).toBe('sent');
    expect(fresh.clinic_note).toBeNull();
    expect(old.stage).toBe('reviewed');
    expect(old.clinic_note).toMatch(/Baxter/);
  });
});

describe('tenancy', () => {
  it("rejects another household's engagement surfaces", async () => {
    for (const path of ['briefing', 'score', 'milestones', 'dealer', 'orders']) {
      const res = await request(app).get(`/v1/households/${REF.householdId}/${path}`).set(...SAM);
      expect(res.status).toBe(403);
    }
    const shares = await request(app).get(`/v1/pets/${REF.baxter}/vet-report/shares`).set(...SAM);
    expect(shares.status).toBe(403);
  });
});
