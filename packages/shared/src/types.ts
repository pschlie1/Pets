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

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
