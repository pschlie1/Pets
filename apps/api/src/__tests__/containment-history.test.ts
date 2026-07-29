import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { pointInPolygon, YARD_GEOMETRIES, type DayHistoryResponse, type HeatmapResponse } from '@connected-care/shared';
import { buildApp } from '../app';
import { getDb, type Db } from '../db/connection';
import { REF, seedAll } from '../db/seed';
import { localDate } from '../engine/containment';

let app: Express;
let db: Db;
let AUTH: readonly ['Authorization', string] = ['Authorization', 'Bearer unset'];
let SAM: readonly ['Authorization', string] = ['Authorization', 'Bearer unset'];

const heatmap = async (query: string): Promise<{ status: number; data: HeatmapResponse; error?: { code: string } }> => {
  const res = await request(app)
    .get(`/v1/households/${REF.householdId}/containment/heatmap${query}`)
    .set(...AUTH);
  return { status: res.status, data: res.body.data, error: res.body.error };
};

const history = async (date: string): Promise<{ status: number; data: DayHistoryResponse; error?: { code: string } }> => {
  const res = await request(app)
    .get(`/v1/households/${REF.householdId}/containment/history?date=${date}`)
    .set(...AUTH);
  return { status: res.status, data: res.body.data, error: res.body.error };
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

describe('movement heatmap', () => {
  it('bins each dog\'s check-ins into the yard grid, counts consistent', async () => {
    const { status, data } = await heatmap('?days=7');
    expect(status).toBe(200);
    expect(data.bbox).not.toBeNull();
    expect(data.pets.map((p) => p.name).sort()).toEqual(['Lilo', 'Meeko']);
    for (const pet of data.pets) {
      // ~96 checks/day; some may fall on unreturned-breach/offline pauses, so just assert plenty.
      expect(pet.total_points).toBeGreaterThan(300);
      expect(pet.cells.reduce((s, c) => s + c.count, 0)).toBe(pet.total_points);
      expect(pet.max_cell_count).toBe(Math.max(...pet.cells.map((c) => c.count)));
      for (const cell of pet.cells) {
        expect(cell.r).toBeGreaterThanOrEqual(0);
        expect(cell.r).toBeLessThan(data.rows);
        expect(cell.c).toBeGreaterThanOrEqual(0);
        expect(cell.c).toBeLessThan(data.cols);
      }
    }
  });

  it('a shorter period is a subset of a longer one', async () => {
    const day = await heatmap('?days=1');
    const week = await heatmap('?days=7');
    for (const petDay of day.data.pets) {
      const petWeek = week.data.pets.find((p) => p.pet_id === petDay.pet_id)!;
      expect(petDay.total_points).toBeLessThanOrEqual(petWeek.total_points);
    }
  });

  it('filters to one pet and 404s an unknown pet', async () => {
    const one = await heatmap(`?days=7&pet_id=${REF.meeko}`);
    expect(one.data.pets).toHaveLength(1);
    expect(one.data.pets[0].pet_id).toBe(REF.meeko);
    const missing = await heatmap('?days=7&pet_id=pet_nope');
    expect(missing.status).toBe(404);
  });

  it('rejects an out-of-range period', async () => {
    const res = await heatmap('?days=99');
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('validation_error');
  });
});

describe('day movement history', () => {
  it('returns a full ordered day of movement with sane stats', async () => {
    const yesterday = localDate(Date.now() - 24 * 3_600_000);
    const { status, data } = await history(yesterday);
    expect(status).toBe(200);
    expect(data.date).toBe(yesterday);
    expect(data.available_dates[0]).toBe(localDate(Date.now()));
    for (const pet of data.pets) {
      expect(pet.points.length).toBeGreaterThan(80); // ~96 checks in a full day
      const times = pet.points.map((p) => p.t);
      expect([...times].sort()).toEqual(times);
      expect(pet.stats.checks).toBe(pet.points.length);
      expect(pet.stats.distance_m).toBeGreaterThan(0);
      expect(pet.stats.busiest_hour).toBeGreaterThanOrEqual(0);
      expect(pet.stats.busiest_hour).toBeLessThan(24);
      // The wander series never leaves the fence on an ordinary day.
      const inside = pet.points.filter((p) => pointInPolygon(p, YARD_GEOMETRIES[REF.householdId].polygon));
      expect(inside.length / pet.points.length).toBeGreaterThan(0.95);
    }
  });

  it('a date before the seed window has no movement', async () => {
    const { status, data } = await history('2020-01-01');
    expect(status).toBe(200);
    for (const pet of data.pets) expect(pet.points).toHaveLength(0);
  });

  it('rejects a malformed date', async () => {
    const res = await history('not-a-date');
    expect(res.status).toBe(400);
  });

  it('the emergency breach shows up in that day\'s events with an outside position', async () => {
    await request(app)
      .post(`/v1/demo/households/${REF.householdId}/scenarios/emergency_boundary_breach`)
      .set(...AUTH);
    const today = await history(localDate(Date.now()));
    const lilo = today.data.pets.find((p) => p.pet_id === REF.lilo)!;
    const breach = lilo.events.find((e) => e.kind === 'breach');
    expect(breach).toBeDefined();
    expect(breach!.position).not.toBeNull();
    expect(pointInPolygon(breach!.position!, YARD_GEOMETRIES[REF.householdId].polygon)).toBe(false);
    expect(lilo.stats.boundary_events).toBeGreaterThan(0);
    // Clean up for any later suites sharing this db.
    await request(app).post(`/v1/demo/households/${REF.householdId}/reset`).set(...AUTH);
  });
});

describe('tenancy', () => {
  it("rejects another household's heatmap and history", async () => {
    const heat = await request(app)
      .get(`/v1/households/${REF.householdId}/containment/heatmap?days=7`)
      .set(...SAM);
    expect(heat.status).toBe(403);
    const day = await request(app)
      .get(`/v1/households/${REF.householdId}/containment/history?date=2026-07-28`)
      .set(...SAM);
    expect(day.status).toBe(403);
  });
});
