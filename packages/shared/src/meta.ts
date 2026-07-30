import { URGENCY_TIERS, urgencyRank, type Urgency } from './enums';
import { BOUNDARY_CHECK_INTERVAL_MIN, SIGNAL_LOSS_MIN, SIGNAL_STALE_MIN } from './containment';
import type { ScoreBand } from './types';

/**
 * The client contract: everything a presentation layer needs to render the
 * Connected Care experience beyond raw tenant data — metric catalog, tier
 * language, score bands, thresholds. Served verbatim by GET /v1/meta so any
 * client (this repo's web app included) reads it from the API instead of
 * compiling it in. One source of truth; the API and every screen agree.
 */

export interface TrendMetricDef {
  metric: 'resting_heart_rate' | 'water_intake_ml' | 'walk_minutes' | 'sleep_hours' | 'food_intake_g';
  label: string;
  unit: string;
}

/** The five chartable metrics, in display order. */
export const TREND_METRIC_DEFS: TrendMetricDef[] = [
  { metric: 'resting_heart_rate', label: 'Resting heart rate', unit: 'bpm' },
  { metric: 'water_intake_ml', label: 'Water intake', unit: 'ml/day' },
  { metric: 'walk_minutes', label: 'Walk time', unit: 'min/day' },
  { metric: 'sleep_hours', label: 'Sleep', unit: 'hrs/night' },
  { metric: 'food_intake_g', label: 'Food intake', unit: 'g/day' },
];

export interface TierExplainer {
  what_we_saw: string;
  what_we_do: string;
  what_you_do: string;
}

/** The five urgency levels in customer language. Wording mirrors the agent
 *  templates so the product speaks with one voice — in every client. */
export const TIER_EXPLAINERS: Record<Urgency, TierExplainer> = {
  info: {
    what_we_saw: "Readings comfortably inside your pet's own normal range.",
    what_we_do: 'Keep logging quietly in the background.',
    what_you_do: 'Nothing — enjoy your day.',
  },
  monitor: {
    what_we_saw: 'A single reading outside the usual range — a blip, not a pattern.',
    what_we_do: 'Re-check automatically on the next cycle and only escalate if it repeats.',
    what_you_do: "Nothing yet — we're watching it for you.",
  },
  attention: {
    what_we_saw: 'A few days of drift from baseline, often with an everyday explanation like hot weather.',
    what_we_do: 'Compare against the rest of the household and local conditions to rule out simple causes.',
    what_you_do: 'Keep an eye on your pet and check back in a few days.',
  },
  urgent: {
    what_we_saw: "A sustained pattern well outside your pet's own baseline with no everyday explanation.",
    what_we_do: 'Assemble the data into a report you can share with your vet.',
    what_you_do:
      'Schedule a vet visit and bring the report — this is pattern detection from device data, not a diagnosis.',
  },
  emergency: {
    what_we_saw: 'A safety-critical event, like a pet outside the boundary and not moving.',
    what_we_do: 'Alert you immediately and notify your local dealer associate in parallel.',
    what_you_do: "Go to your pet now, and call your emergency vet if they're unresponsive.",
  },
};

export interface ScoreBandDef {
  key: ScoreBand;
  /** Lowest score that still falls in this band. */
  min_score: number;
  label: string;
}

/** Descending by min_score; the score engine and every gauge read from here. */
export const SCORE_BANDS: ScoreBandDef[] = [
  { key: 'protected', min_score: 90, label: 'Protected' },
  { key: 'good', min_score: 70, label: 'Good' },
  { key: 'needs_attention', min_score: 40, label: 'Needs attention' },
  { key: 'act_now', min_score: 0, label: 'Act now' },
];

export function scoreBandFor(score: number): ScoreBandDef {
  return SCORE_BANDS.find((b) => score >= b.min_score) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

/** The full /v1/meta payload. */
export interface ClientMeta {
  urgency_tiers: { key: Urgency; rank: number; explainer: TierExplainer }[];
  insight_types: string[];
  trend_metrics: TrendMetricDef[];
  score_bands: ScoreBandDef[];
  containment: { check_interval_min: number; stale_after_min: number; signal_loss_min: number };
  species: string[];
  share_methods: string[];
}

export function buildClientMeta(): ClientMeta {
  return {
    urgency_tiers: URGENCY_TIERS.map((key) => ({ key, rank: urgencyRank(key), explainer: TIER_EXPLAINERS[key] })),
    insight_types: ['pet_health', 'pet_safety', 'equipment'],
    trend_metrics: TREND_METRIC_DEFS,
    score_bands: SCORE_BANDS,
    containment: {
      check_interval_min: BOUNDARY_CHECK_INTERVAL_MIN,
      stale_after_min: SIGNAL_STALE_MIN,
      signal_loss_min: SIGNAL_LOSS_MIN,
    },
    species: ['dog', 'cat', 'other'],
    share_methods: ['portal', 'email', 'link'],
  };
}
