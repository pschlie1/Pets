import type { AgentReply, ApiErrorBody, Insight, ScenarioMeta } from '@connected-care/shared';

const TOKEN = 'demo-token';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await res.json()) as { data: T } | ApiErrorBody;
  if (!res.ok || 'error' in body) {
    const message = 'error' in body ? body.error.message : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body.data;
}

export interface PetSummary {
  id: string;
  name: string;
  species: string;
  breed_id: string | null;
  date_of_birth: string | null;
  weight_lbs: number | null;
  sex: string | null;
}

export interface DeviceSummary {
  id: string;
  device_type: string;
  model: string | null;
  assignment_mode: string;
  status: string;
}

export interface HouseholdDetail {
  id: string;
  location_city: string;
  location_state: string;
  pets: PetSummary[];
  devices: DeviceSummary[];
}

export interface PetDetailData extends PetSummary {
  breed_name: string | null;
  resting_hr_low: number | null;
  resting_hr_high: number | null;
  common_conditions: { condition: string; typical_onset: string; monitorable_today: boolean }[];
  devices: DeviceSummary[];
}

export interface MetricSeries {
  metric: string;
  points: { days_ago: number; value: number }[];
  baseline: { mean: number; stdev: number; status: string } | null;
}

export interface DeviceStatus extends DeviceSummary {
  last_seen: string | null;
  last_health_ping: (Record<string, unknown> & { occurred_at: string; battery_pct?: number }) | null;
}

export interface InsightPage {
  items: Insight[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

export const HOUSEHOLD_ID = 'hh_2291';

export const api = {
  getHousehold: () => request<HouseholdDetail>(`/v1/households/${HOUSEHOLD_ID}`),
  getPet: (petId: string) => request<PetDetailData>(`/v1/pets/${petId}`),
  getPetMetrics: (petId: string, metric: string, days = 14) =>
    request<MetricSeries>(`/v1/pets/${petId}/metrics?metric=${metric}&days=${days}`),
  getDeviceStatus: (deviceId: string) => request<DeviceStatus>(`/v1/devices/${deviceId}/status`),
  getInsights: async (params: { page?: number; limit?: number; pet_id?: string; urgency?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.pet_id) q.set('pet_id', params.pet_id);
    if (params.urgency) q.set('urgency', params.urgency);
    const res = await fetch(`/v1/households/${HOUSEHOLD_ID}/insights?${q}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? 'Failed to load insights');
    return { items: body.data as Insight[], pagination: body.pagination } as InsightPage;
  },
  acknowledgeInsight: (id: string) => request<Insight>(`/v1/insights/${id}/acknowledge`, { method: 'POST' }),
  dismissInsight: (id: string) => request<Insight>(`/v1/insights/${id}/dismiss`, { method: 'POST' }),
  askAgent: (petId: string, question: string) =>
    request<AgentReply>('/v1/agent/query', { method: 'POST', body: JSON.stringify({ pet_id: petId, question }) }),
  getScenarios: () => request<ScenarioMeta[]>('/v1/demo/scenarios'),
  seedDemo: () => request<{ household_id: string; seeded: boolean }>('/v1/demo/households', { method: 'POST' }),
  resetDemo: () =>
    request<{ household_id: string; reset: boolean }>(`/v1/demo/households/${HOUSEHOLD_ID}/reset`, { method: 'POST' }),
  triggerScenario: (key: string) =>
    request<{ scenario: ScenarioMeta; insights: Insight[]; note?: string }>(
      `/v1/demo/households/${HOUSEHOLD_ID}/scenarios/${key}`,
      { method: 'POST' },
    ),
};
