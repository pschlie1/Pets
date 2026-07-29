import type {
  AgentReply,
  ApiErrorBody,
  Briefing,
  Consumable,
  ContainmentStatus,
  DayHistoryResponse,
  DealerStatus,
  HeatmapResponse,
  Insight,
  LoginResponse,
  Milestone,
  Order,
  Owner,
  PeaceOfMindScore,
  ScenarioMeta,
  VetReport,
  VetShare,
  VetShareWithStatus,
} from '@connected-care/shared';

/**
 * Session state, set by AuthContext after login. Nothing tenant-specific is
 * hardcoded — the household id comes from the authenticated owner's claim.
 */
let sessionToken = '';
let sessionHouseholdId = '';

export function setSession(token: string, householdId: string): void {
  sessionToken = token;
  sessionHouseholdId = householdId;
}

export function getSession(): { token: string; householdId: string } {
  return { token: sessionToken, householdId: sessionHouseholdId };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  // A crashed backend can return a non-JSON body; surface the status instead
  // of the browser's cryptic JSON parse error.
  let body: { data: T } | ApiErrorBody | null = null;
  try {
    body = (await res.json()) as { data: T } | ApiErrorBody;
  } catch {
    body = null;
  }
  if (!res.ok || !body || 'error' in body) {
    const message =
      body && 'error' in body ? body.error.message : `The service returned ${res.status} — please try again.`;
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

export const api = {
  login: (email: string) =>
    request<LoginResponse>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email }) }),
  getDemoIdentities: () => request<Owner[]>('/v1/auth/demo-identities'),
  getHousehold: () => request<HouseholdDetail>(`/v1/households/${sessionHouseholdId}`),
  getContainment: () => request<ContainmentStatus>(`/v1/households/${sessionHouseholdId}/containment`),
  getContainmentHeatmap: (days: number, petId?: string) =>
    request<HeatmapResponse>(
      `/v1/households/${sessionHouseholdId}/containment/heatmap?days=${days}${petId ? `&pet_id=${petId}` : ''}`,
    ),
  getContainmentHistory: (date: string) =>
    request<DayHistoryResponse>(`/v1/households/${sessionHouseholdId}/containment/history?date=${date}`),
  getBriefing: () => request<Briefing>(`/v1/households/${sessionHouseholdId}/briefing`),
  getScore: () => request<PeaceOfMindScore>(`/v1/households/${sessionHouseholdId}/score`),
  getMilestones: () => request<Milestone[]>(`/v1/households/${sessionHouseholdId}/milestones`),
  getDealer: () => request<DealerStatus>(`/v1/households/${sessionHouseholdId}/dealer`),
  getOrders: () => request<Order[]>(`/v1/households/${sessionHouseholdId}/orders`),
  getConsumables: () => request<Consumable[]>('/v1/catalog/consumables'),
  placeOrder: (deviceId: string, sku: string) =>
    request<Order>('/v1/orders', { method: 'POST', body: JSON.stringify({ device_id: deviceId, sku }) }),
  getVetShares: (petId: string) => request<VetShareWithStatus[]>(`/v1/pets/${petId}/vet-report/shares`),
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
    const res = await fetch(`/v1/households/${sessionHouseholdId}/insights?${q}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(body?.error?.message ?? `Failed to load insights (${res.status})`);
    return { items: body.data as Insight[], pagination: body.pagination } as InsightPage;
  },
  acknowledgeInsight: (id: string) => request<Insight>(`/v1/insights/${id}/acknowledge`, { method: 'POST' }),
  dismissInsight: (id: string) => request<Insight>(`/v1/insights/${id}/dismiss`, { method: 'POST' }),
  getVetReport: (petId: string) => request<VetReport>(`/v1/pets/${petId}/vet-report`),
  shareVetReport: (petId: string, body: { recipient: string; method: 'portal' | 'email' | 'link' }) =>
    request<VetShare>(`/v1/pets/${petId}/vet-report/share`, { method: 'POST', body: JSON.stringify(body) }),
  askAgent: (petId: string, question: string) =>
    request<AgentReply>('/v1/agent/query', { method: 'POST', body: JSON.stringify({ pet_id: petId, question }) }),
  getScenarios: () => request<ScenarioMeta[]>('/v1/demo/scenarios'),
  seedDemo: () => request<{ household_id: string; seeded: boolean }>('/v1/demo/households', { method: 'POST' }),
  resetDemo: () =>
    request<{ household_id: string; reset: boolean }>(`/v1/demo/households/${sessionHouseholdId}/reset`, { method: 'POST' }),
  triggerScenario: (key: string) =>
    request<{ scenario: ScenarioMeta; insights: Insight[]; note?: string }>(
      `/v1/demo/households/${sessionHouseholdId}/scenarios/${key}`,
      { method: 'POST' },
    ),
};
