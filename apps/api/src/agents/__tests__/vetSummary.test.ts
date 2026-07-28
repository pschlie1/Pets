import { describe, expect, it } from 'vitest';
import { vetSummaryTemplate, type VetSummaryInput } from '../fallback';

const base: VetSummaryInput = {
  petName: 'Baxter',
  species: 'dog',
  breedName: 'Cavalier King Charles Spaniel',
  ageYears: 9,
  weightLbs: 16.2,
  sex: 'male',
  windowDays: 14,
  deltas: [],
  insights: [],
  breed: {
    restingHrLow: 90,
    restingHrHigh: 140,
    conditions: [{ condition: 'mitral valve disease', typical_onset: 'age 5-7 for half the breed' }],
    isGenericFallback: false,
  },
  containmentState: 'protected',
};

describe('vetSummaryTemplate', () => {
  it('names the metric and percent for a >2σ deviation, grounded in real values', () => {
    const text = vetSummaryTemplate({
      ...base,
      deltas: [
        { metric: 'resting_heart_rate', latest: 110, mean: 96, stdev: 2, sigma: 7, pct: 15, status: 'established' },
        { metric: 'water_intake_ml', latest: 660, mean: 680, stdev: 60, sigma: 0.3, pct: -3, status: 'established' },
      ],
    });
    expect(text).toMatch(/resting heart rate/);
    expect(text).toMatch(/110/);
    expect(text).toMatch(/15% above/);
    expect(text).toMatch(/not a diagnosis/);
    expect(text).toMatch(/14 days/);
  });

  it('states all-within-one-sigma when nothing deviates', () => {
    const text = vetSummaryTemplate({
      ...base,
      deltas: [
        { metric: 'resting_heart_rate', latest: 96, mean: 96, stdev: 2, sigma: 0, pct: 0, status: 'established' },
        { metric: 'walk_minutes', latest: 55, mean: 57, stdev: 6, sigma: 0.3, pct: -4, status: 'established' },
      ],
    });
    expect(text).toMatch(/within one standard deviation/);
  });

  it('reports insufficient-data baselines as lacking a baseline, never interpreted', () => {
    const text = vetSummaryTemplate({
      ...base,
      deltas: [
        { metric: 'sleep_hours', latest: 4, mean: 10, stdev: 0.5, sigma: 12, pct: -60, status: 'insufficient_data' },
      ],
    });
    expect(text).toMatch(/lacks a reliable baseline/);
    expect(text).not.toMatch(/60%/);
  });

  it('never uses exclamation marks or emoji (clinical register)', () => {
    const text = vetSummaryTemplate({
      ...base,
      deltas: [
        { metric: 'resting_heart_rate', latest: 110, mean: 96, stdev: 2, sigma: 7, pct: 15, status: 'established' },
      ],
      insights: [{ urgency: 'urgent', summary: 'Heart rate elevated for 3 days.' }],
    });
    expect(text).not.toMatch(/!/);
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
