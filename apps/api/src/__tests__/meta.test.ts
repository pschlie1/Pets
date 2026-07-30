import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  BOUNDARY_CHECK_INTERVAL_MIN,
  SIGNAL_LOSS_MIN,
  SIGNAL_STALE_MIN,
  urgencyRank,
  type ClientMeta,
} from '@connected-care/shared';
import { buildApp } from '../app';
import { getDb } from '../db/connection';
import { seedAll } from '../db/seed';

let app: Express;

beforeAll(() => {
  const db = getDb(':memory:');
  seedAll(db);
  app = buildApp(db).app;
});

describe('the client contract — GET /v1/meta', () => {
  it('is public and carries everything a presentation layer needs', async () => {
    const res = await request(app).get('/v1/meta'); // deliberately no auth
    expect(res.status).toBe(200);
    const meta = res.body.data as ClientMeta;

    // Tiers: all five, ordered, ranks matching the canonical ordering.
    expect(meta.urgency_tiers.map((t) => t.key)).toEqual(['info', 'monitor', 'attention', 'urgent', 'emergency']);
    for (const tier of meta.urgency_tiers) {
      expect(tier.rank).toBe(urgencyRank(tier.key));
      expect(tier.explainer.what_we_saw.length).toBeGreaterThan(10);
      expect(tier.explainer.what_we_do.length).toBeGreaterThan(10);
      expect(tier.explainer.what_you_do.length).toBeGreaterThan(5);
    }

    // The chartable metrics with display labels, units, and species applicability.
    expect(meta.trend_metrics).toHaveLength(6);
    for (const m of meta.trend_metrics) {
      expect(m.label.length).toBeGreaterThan(2);
      expect(m.unit.length).toBeGreaterThan(1);
      expect(m.species.length).toBeGreaterThan(0);
    }
    expect(meta.trend_metrics.find((m) => m.metric === 'litter_visits_per_day')?.species).toEqual(['cat']);

    // Score bands cover 0-100, descending, labelled.
    expect(meta.score_bands.map((b) => b.min_score)).toEqual([90, 70, 40, 0]);
    for (const b of meta.score_bands) expect(b.label.length).toBeGreaterThan(2);

    // Thresholds mirror the shared constants the engine uses.
    expect(meta.containment).toEqual({
      check_interval_min: BOUNDARY_CHECK_INTERVAL_MIN,
      stale_after_min: SIGNAL_STALE_MIN,
      signal_loss_min: SIGNAL_LOSS_MIN,
    });
  });
});

describe('CORS — any presentation layer origin can consume the API', () => {
  it('answers preflight and stamps allow headers on responses', async () => {
    const preflight = await request(app)
      .options('/v1/households/hh_2291')
      .set('Origin', 'https://other-presentation-layer.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'Authorization');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://other-presentation-layer.example');
    expect(preflight.headers['access-control-allow-headers']).toMatch(/Authorization/);

    const res = await request(app).get('/v1/meta').set('Origin', 'https://other-presentation-layer.example');
    expect(res.headers['access-control-allow-origin']).toBe('https://other-presentation-layer.example');
  });
});
