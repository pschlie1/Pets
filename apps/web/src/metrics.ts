/** The five tracked metrics, shared by the pet trends page and the vet report. */
export const TREND_METRICS = [
  { metric: 'resting_heart_rate', label: 'Resting heart rate', unit: 'bpm' },
  { metric: 'water_intake_ml', label: 'Water intake', unit: 'ml/day' },
  { metric: 'walk_minutes', label: 'Walk time', unit: 'min/day' },
  { metric: 'sleep_hours', label: 'Sleep', unit: 'hrs/night' },
  { metric: 'food_intake_g', label: 'Food intake', unit: 'g/day' },
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number];
