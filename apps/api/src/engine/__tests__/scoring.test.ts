import { describe, expect, it } from 'vitest';
import { scoreEquipment, scoreMetric, scoreSafetyEvent } from '../scoring';

const established = (mean: number, stdev: number) => ({ mean, stdev, status: 'established' as const });

describe('scoreMetric — the six PRD showcase scenarios', () => {
  it('S1 info: a 5% water dip inside personal and breed range stays info', () => {
    const result = scoreMetric({
      metric: 'water_intake_ml',
      value: 545 * 0.95,
      baseline: established(545, 80),
      durationDays: 1,
      sibling: { deviates: false },
      environment: { explainsDeviation: false },
    });
    expect(result.urgency).toBe('info');
  });

  it('S2 monitor: feeder drift twice in a week is monitor, no push', () => {
    const result = scoreEquipment({ metric: 'feeder_schedule_drift_min', occurrences: 2 });
    expect(result.urgency).toBe('monitor');
  });

  it('S3 attention: both dogs drop together in a cold snap → downgraded from urgent, not two alarms', () => {
    const result = scoreMetric({
      metric: 'water_intake_ml',
      value: 680 * 0.45,
      baseline: established(680, 85),
      durationDays: 2,
      sibling: { deviates: true },
      environment: { explainsDeviation: true },
    });
    expect(result.urgency).toBe('attention');
    expect(result.factors.join(' ')).toMatch(/downgraded/);
  });

  it('S4 attention: fountain flow down 30% over five days reads as filter wear', () => {
    const result = scoreEquipment({ metric: 'fountain_flow_rate', changeRatio: 0.7 });
    expect(result.urgency).toBe('attention');
  });

  it('S5 urgent: Meeko 15% above HR baseline for 3 days, sibling normal, breed cardiac risk', () => {
    const result = scoreMetric({
      metric: 'resting_heart_rate',
      value: 110,
      baseline: established(95.6, 1.9),
      durationDays: 3,
      breedRange: { low: 90, high: 140, isGenericFallback: false },
      sibling: { deviates: false },
      environment: { explainsDeviation: false },
      breedRiskWeight: 1.6,
    });
    expect(result.urgency).toBe('urgent');
    expect(result.factors.join(' ')).toMatch(/shared cause ruled out/);
  });

  it('S6 emergency: boundary breach with extended no-motion bypasses statistics', () => {
    const result = scoreSafetyEvent({ eventType: 'boundary_breach', minutesOutsideZone: 22, motionDetected: false });
    expect(result.urgency).toBe('emergency');
  });
});

describe('scoreMetric — pipeline mechanics', () => {
  it('upgrades one tier when the sibling reads normal and weather is ruled out', () => {
    const base = {
      metric: 'resting_heart_rate',
      value: 104,
      baseline: established(96, 2.5),
      durationDays: 2,
      environment: { explainsDeviation: false },
    };
    const alone = scoreMetric({ ...base, sibling: null });
    const withSibling = scoreMetric({ ...base, sibling: { deviates: false } });
    expect(['monitor', 'attention', 'urgent']).toContain(alone.urgency);
    const order = ['info', 'monitor', 'attention', 'urgent', 'emergency'];
    expect(order.indexOf(withSibling.urgency)).toBe(order.indexOf(alone.urgency) + 1);
  });

  it('downgrades when both pets deviate and the environment explains it', () => {
    const base = {
      metric: 'water_intake_ml',
      value: 400,
      baseline: established(680, 85),
      durationDays: 2,
    };
    const unexplained = scoreMetric({ ...base, sibling: { deviates: true }, environment: { explainsDeviation: false } });
    const explained = scoreMetric({ ...base, sibling: { deviates: true }, environment: { explainsDeviation: true } });
    const order = ['info', 'monitor', 'attention', 'urgent', 'emergency'];
    expect(order.indexOf(explained.urgency)).toBe(order.indexOf(unexplained.urgency) - 1);
  });

  it('suppresses to info when the baseline has insufficient data', () => {
    const result = scoreMetric({
      metric: 'resting_heart_rate',
      value: 130,
      baseline: { mean: 96, stdev: 2, status: 'insufficient_data' },
      durationDays: 3,
      breedRange: { low: 90, high: 140, isGenericFallback: false },
    });
    expect(result.urgency).toBe('info');
    expect(result.confidence).toBe('suppressed');
  });

  it('caps a generic-fallback breed profile at attention with low confidence', () => {
    const result = scoreMetric({
      metric: 'resting_heart_rate',
      value: 130,
      baseline: established(96, 2),
      durationDays: 4,
      breedRange: { low: 70, high: 120, isGenericFallback: true },
      sibling: { deviates: false },
      environment: { explainsDeviation: false },
    });
    expect(result.confidence).toBe('low');
    expect(result.urgency).toBe('attention');
  });

  it('never escalates a statistical anomaly to emergency', () => {
    const result = scoreMetric({
      metric: 'resting_heart_rate',
      value: 200,
      baseline: established(96, 1),
      durationDays: 10,
      breedRange: { low: 90, high: 140, isGenericFallback: false },
      sibling: { deviates: false },
      environment: { explainsDeviation: false },
      breedRiskWeight: 1.6,
    });
    expect(result.urgency).toBe('urgent');
  });

  it('breed risk weight can cross a tier threshold', () => {
    const input = {
      metric: 'resting_heart_rate',
      value: 103,
      baseline: established(96, 2.4),
      durationDays: 2,
      breedRange: { low: 90, high: 140, isGenericFallback: false },
      environment: { explainsDeviation: false },
    };
    const unweighted = scoreMetric({ ...input, breedRiskWeight: 1 });
    const weighted = scoreMetric({ ...input, breedRiskWeight: 1.6 });
    expect(weighted.severityScore).toBeGreaterThan(unweighted.severityScore);
  });

  it('a breach with motion still detected is urgent, not emergency', () => {
    const result = scoreSafetyEvent({ eventType: 'boundary_breach', minutesOutsideZone: 3, motionDetected: true });
    expect(result.urgency).toBe('urgent');
  });

  it('equipment degradation that threatens containment scores as urgent', () => {
    const result = scoreEquipment({ metric: 'collar_battery_pct', threatensSafety: true });
    expect(result.urgency).toBe('urgent');
  });
});

describe('containment safety events', () => {
  it('signal loss scores as attention — verification lost, not a breach', () => {
    const result = scoreSafetyEvent({ eventType: 'signal_lost', minutesSinceCheckIn: 120 });
    expect(result.urgency).toBe('attention');
    expect(result.factors.join(' ')).toMatch(/cannot be verified/);
  });

  it('a brief breach with motion and safe return scores as monitor', () => {
    const result = scoreSafetyEvent({ eventType: 'breach_safe_return', minutesOutsideZone: 7, motionDetected: true });
    expect(result.urgency).toBe('monitor');
  });

  it('an active breach with motion is still urgent after the union refactor', () => {
    const result = scoreSafetyEvent({ eventType: 'boundary_breach', minutesOutsideZone: 3, motionDetected: true });
    expect(result.urgency).toBe('urgent');
  });

  it('breach + extended no-motion remains the only emergency path', () => {
    const result = scoreSafetyEvent({ eventType: 'boundary_breach', minutesOutsideZone: 22, motionDetected: false });
    expect(result.urgency).toBe('emergency');
  });
});
