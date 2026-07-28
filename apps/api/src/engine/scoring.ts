import type { Urgency } from '@connected-care/shared';

/**
 * The insight scoring pipeline — the product's core differentiator.
 * Pure functions only: no DB, no I/O. Everything here is unit-tested against
 * the six PRD showcase scenarios.
 *
 * Pipeline per the PRD:
 *   1. personal deviation from the pet's own 14-day baseline (in stdevs)
 *   2. breed cohort range check
 *   3. sibling divergence: upgrade if the co-housed same-species pet is normal
 *      (shared cause ruled out); downgrade if both deviate and environment explains
 *   4. map severity → urgency tier, weighted by breed risk for the metric
 */

export interface ScoringInput {
  metric: string;
  value: number;
  baseline: { mean: number; stdev: number; status: 'established' | 'insufficient_data' };
  /** Days the deviation has persisted (1 = single reading). */
  durationDays?: number;
  breedRange?: { low: number; high: number; isGenericFallback: boolean } | null;
  /** Same-species co-housed pet only; omit when none exists (or different species). */
  sibling?: { deviates: boolean } | null;
  environment?: { explainsDeviation: boolean } | null;
  /** >1 for metrics tied to a documented breed risk (e.g. CKCS cardiac at senior age). */
  breedRiskWeight?: number;
}

export interface ScoringResult {
  severityScore: number;
  urgency: Urgency;
  personalDeviation: number;
  confidence: 'normal' | 'low' | 'suppressed';
  factors: string[];
}

const TIER_ORDER: Urgency[] = ['info', 'monitor', 'attention', 'urgent', 'emergency'];

function shiftTier(u: Urgency, by: number): Urgency {
  const idx = Math.min(Math.max(TIER_ORDER.indexOf(u) + by, 0), TIER_ORDER.length - 1);
  return TIER_ORDER[idx];
}

export function scoreMetric(input: ScoringInput): ScoringResult {
  const factors: string[] = [];
  const { baseline } = input;
  const riskWeight = input.breedRiskWeight ?? 1;
  const duration = input.durationDays ?? 1;

  const personalDeviation = baseline.stdev > 0 ? (input.value - baseline.mean) / baseline.stdev : 0;
  const absDev = Math.abs(personalDeviation);

  // Baseline not established → never alarm off thin data.
  if (baseline.status === 'insufficient_data') {
    factors.push('baseline has insufficient data — insight suppressed to info');
    return {
      severityScore: Math.min(absDev, 1),
      urgency: 'info',
      personalDeviation,
      confidence: 'suppressed',
      factors,
    };
  }

  // 1. Personal deviation is the primary signal; persistence compounds it.
  let score = absDev * (1 + 0.35 * (duration - 1));
  if (absDev >= 1) factors.push(`${absDev.toFixed(1)}σ from personal baseline`);
  if (duration > 1) factors.push(`persisted ${duration} days`);

  // 2. Breed cohort range check.
  let confidence: ScoringResult['confidence'] = 'normal';
  if (input.breedRange) {
    if (input.value < input.breedRange.low || input.value > input.breedRange.high) {
      score += 1;
      factors.push('outside breed reference range');
    }
    if (input.breedRange.isGenericFallback) {
      confidence = 'low';
      factors.push('species-generic reference profile (low confidence)');
    }
  }

  // 3. Breed risk weighting (before tier mapping so it can cross thresholds).
  if (riskWeight > 1 && absDev >= 1) {
    score *= riskWeight;
    factors.push('metric matches a documented breed risk');
  }

  // 4. Map to tier.
  let urgency: Urgency;
  if (score < 1.25) urgency = 'info';
  else if (score < 2.5) urgency = 'monitor';
  else if (score < 4.5) urgency = 'attention';
  else urgency = 'urgent';

  // 5. Household-peer comparison — the check a single-pet home could never run.
  const environmentExplains = input.environment?.explainsDeviation ?? false;
  if (input.sibling && absDev >= 1) {
    if (!input.sibling.deviates && !environmentExplains && urgency !== 'info') {
      urgency = shiftTier(urgency, 1);
      factors.push('sibling reads normal — shared cause ruled out, severity upgraded');
    } else if (input.sibling.deviates && environmentExplains) {
      urgency = shiftTier(urgency, -1);
      factors.push('sibling deviates too and weather explains it — severity downgraded');
    }
  } else if (!input.sibling && environmentExplains && absDev >= 1) {
    urgency = shiftTier(urgency, -1);
    factors.push('weather likely explains this change — severity downgraded');
  }

  // Emergency is reserved for safety events (containment loss, no-motion).
  // Statistical anomalies cap at urgent no matter how extreme the numbers.
  if (urgency === 'emergency') urgency = 'urgent';

  if (confidence === 'low' && urgency === 'urgent') {
    urgency = 'attention';
    factors.push('capped at attention due to low-confidence breed reference');
  }

  return { severityScore: Math.round(score * 100) / 100, urgency, personalDeviation, confidence, factors };
}

/**
 * Safety events bypass statistical scoring: a boundary breach with extended
 * no-motion is an emergency regardless of any baseline.
 */
export interface SafetyEventInput {
  eventType: 'boundary_breach';
  minutesOutsideZone: number;
  motionDetected: boolean;
}

export function scoreSafetyEvent(input: SafetyEventInput): ScoringResult {
  const noMotion = !input.motionDetected && input.minutesOutsideZone >= 10;
  return {
    severityScore: noMotion ? 10 : 6,
    urgency: noMotion ? 'emergency' : 'urgent',
    personalDeviation: 0,
    confidence: 'normal',
    factors: noMotion
      ? ['boundary breach with extended no-motion outside the safe zone']
      : ['boundary breach — pet outside the safe zone'],
  };
}

/**
 * Equipment trend scoring: threshold-based, per the PRD's equipment stories.
 * `changeRatio` is current/normal (e.g. 0.7 = flow down 30%).
 */
export interface EquipmentInput {
  metric: string;
  changeRatio?: number;
  occurrences?: number;
  threatensSafety?: boolean;
}

export function scoreEquipment(input: EquipmentInput): ScoringResult {
  const factors: string[] = [];
  let urgency: Urgency = 'info';
  let score = 0;

  const drop = input.changeRatio !== undefined ? 1 - input.changeRatio : 0;
  if (drop >= 0.25) {
    urgency = 'attention';
    score = 3;
    factors.push(`sustained ${Math.round(drop * 100)}% decline`);
  } else if ((input.occurrences ?? 0) >= 2 || drop >= 0.1) {
    urgency = 'monitor';
    score = 1.5;
    factors.push('early drift, not yet a pattern');
  }

  // A dying collar battery is a maintenance ticket right up until it is a safety gap.
  if (input.threatensSafety) {
    urgency = 'urgent';
    score = Math.max(score, 5);
    factors.push('degradation threatens containment safety');
  }

  return { severityScore: score, urgency, personalDeviation: 0, confidence: 'normal', factors };
}
