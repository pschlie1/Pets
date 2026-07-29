import type {
  AckStatus,
  AssignmentMode,
  BaselineStatus,
  DeviceStatus,
  DeviceType,
  InsightType,
  Metric,
  Species,
  Urgency,
} from './enums';

export interface Household {
  id: string;
  location_city: string;
  location_state: string;
  location_zip: string;
  climate_zone: string | null;
  created_at: string;
}

export interface Pet {
  id: string;
  household_id: string;
  name: string;
  species: Species;
  breed_id: string | null;
  breed_reference_confidence: 'high' | 'low';
  date_of_birth: string | null;
  weight_lbs: number | null;
  sex: string | null;
}

export interface BreedCondition {
  condition: string;
  typical_onset: string;
  monitorable_today: boolean;
}

export interface BreedProfile {
  id: string;
  species: Species;
  breed_name: string | null;
  size_class: string;
  resting_hr_low: number;
  resting_hr_high: number;
  common_conditions: BreedCondition[];
  is_generic_fallback: boolean;
}

export interface Device {
  id: string;
  household_id: string;
  device_type: DeviceType;
  model: string | null;
  assignment_mode: AssignmentMode;
  has_pet_attribution: boolean;
  status: DeviceStatus;
}

export interface PetBaseline {
  pet_id: string;
  metric: Metric;
  mean: number;
  stdev: number;
  window_days: number;
  sample_count: number;
  status: BaselineStatus;
  last_computed: string;
}

export interface TelemetryEvent {
  id: string;
  household_id: string;
  device_id: string;
  pet_id: string | null;
  device_type: DeviceType;
  event_type: string;
  payload: Record<string, unknown>;
  schema_version: number;
  occurred_at: string;
  received_at: string;
  flagged_reason: string | null;
}

export interface Insight {
  id: string;
  household_id: string;
  pet_id: string | null;
  device_id: string | null;
  insight_type: InsightType;
  metric: string;
  severity_score: number;
  urgency: Urgency;
  summary: string;
  recommended_action: string;
  generated_at: string;
  acknowledged_status: AckStatus;
  routed_to_associate: boolean;
  narration_mode: 'claude' | 'template';
}

export interface AgentReply {
  answer: string;
  mode: 'claude' | 'template';
  pet_id: string;
  data_window_days: number;
}

export interface Owner {
  id: string;
  email: string;
  display_name: string;
  household_id: string;
}

export interface LoginResponse {
  token: string;
  owner: Owner;
}

export interface VetShare {
  id: string;
  household_id: string;
  pet_id: string;
  recipient: string;
  method: 'portal' | 'email' | 'link';
  insight_ids: string[];
  shared_at: string;
}

export interface VetReportMetricSeries {
  metric: string;
  points: { days_ago: number; value: number }[];
  baseline: { mean: number; stdev: number; status: string } | null;
}

/** The live vet report — assembled at GET time, never persisted. Only shares persist. */
export interface VetReport {
  report_id: string;
  generated_at: string;
  window_days: number;
  pet: {
    id: string;
    name: string;
    species: Species;
    breed_name: string | null;
    breed_reference_confidence: 'high' | 'low';
    date_of_birth: string | null;
    age_years: number | null;
    weight_lbs: number | null;
    sex: string | null;
  };
  breed: {
    breed_name: string | null;
    size_class: string;
    resting_hr_low: number;
    resting_hr_high: number;
    common_conditions: BreedCondition[];
    is_generic_fallback: boolean;
  } | null;
  summary: { text: string; mode: 'claude' | 'template' };
  baselines: PetBaseline[];
  metrics: VetReportMetricSeries[];
  active_insights: Insight[];
  containment: { state: string; minutes_since_check_in: number | null; battery_pct: number | null } | null;
  environment: { date: string; low_f: number | null; high_f: number | null; conditions: string | null } | null;
  shares: VetShare[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/* ------------------------- engagement & commerce ------------------------- */

/** The daily briefing: a narrated overnight digest plus the facts behind it. */
export interface Briefing {
  household_id: string;
  greeting_period: 'morning' | 'afternoon' | 'evening';
  summary: string;
  facts: { icon: string; text: string }[];
  mode: 'claude' | 'template';
  generated_at: string;
}

export type ScoreBand = 'protected' | 'good' | 'needs_attention' | 'act_now';

/** One 0-100 household read of safety + health + equipment readiness. */
export interface PeaceOfMindScore {
  household_id: string;
  score: number;
  band: ScoreBand;
  factors: { label: string; delta: number }[];
}

/** A win worth celebrating, computed from the telemetry record. */
export interface Milestone {
  icon: string;
  title: string;
  detail: string;
  pet_id: string | null;
}

/** A consumable replacement order placed from an equipment insight. */
export interface Order {
  id: string;
  household_id: string;
  device_id: string;
  sku: string;
  label: string;
  price_cents: number;
  status: 'placed';
  eta_date: string;
  created_at: string;
}

export interface Dealer {
  name: string;
  associate: string;
  phone: string;
}

export type DispatchStep = 'alerted' | 'reviewing' | 'followed_up';

/** The household's dealer plus live dispatch state for a routed emergency. */
export interface DealerStatus {
  household_id: string;
  dealer: Dealer;
  dispatch: {
    insight_id: string;
    summary: string;
    routed_at: string;
    step: DispatchStep;
  } | null;
}

export type VetShareStage = 'sent' | 'delivered' | 'viewed' | 'reviewed';

/** A vet share with its delivery/review stage (derived server-side). */
export interface VetShareWithStatus extends VetShare {
  stage: VetShareStage;
  clinic_note: string | null;
}
