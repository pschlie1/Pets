import type { VetReportMetricSeries } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { callClaude } from './claude';
import { buildPetContext, renderContext, type PetContext } from './context';
import { label, vetSummaryTemplate, type VetSummaryInput } from './fallback';

/**
 * Vet Report Summarizer: writes the professional summary at the top of the
 * shareable vet report. Same pattern as the narrator — Claude when available,
 * deterministic grounded template otherwise.
 */

const SYSTEM = `You are the Vet Report Summarizer for Connected Care. Write a brief professional
summary of a pet's device-data patterns for the owner's veterinarian to read.

Rules — follow every one:
- This is a summary of consumer-device telemetry patterns, NOT a diagnosis,
  differential, or clinical assessment. Never state or imply a condition is present.
- Open with one sentence identifying the pet (name, breed, age, weight) and the
  observation window: "over the last 14 days of device data".
- Neutral clinical register: no exclamation marks, no emoji, no owner-directed
  reassurance language.
- Ground every number strictly in the input. Never invent, extrapolate, or re-round values.
- Report deviations relative to the pet's OWN baseline (percent and sigma), citing
  breed reference ranges only as context.
- Do NOT suggest treatments, medications, tests, or clinical next steps — the
  veterinarian decides those.
- If a baseline is marked INSUFFICIENT DATA, state that the metric lacks a reliable
  baseline; do not interpret it.
- Mention collar/containment status only if the state is not 'protected'.
- Length: 120-180 words, one or two paragraphs of plain prose. No headings, no bullets.`;

interface Delta {
  metric: string;
  latest: number;
  mean: number;
  stdev: number;
  sigma: number;
  pct: number;
  status: string;
}

/** Deltas computed from the report's own metric series, so the written summary can never disagree with the visible charts. */
export function computeDeltas(metrics: VetReportMetricSeries[]): Delta[] {
  const deltas: Delta[] = [];
  for (const m of metrics) {
    const latest = m.points[m.points.length - 1];
    if (!latest || !m.baseline) continue;
    const { mean, stdev, status } = m.baseline;
    const sigma = stdev > 0 ? Math.abs(latest.value - mean) / stdev : 0;
    const pct = mean !== 0 ? Math.round(((latest.value - mean) / mean) * 100) : 0;
    deltas.push({ metric: m.metric, latest: latest.value, mean, stdev, sigma, pct, status });
  }
  return deltas;
}

function renderDeltas(deltas: Delta[]): string {
  const lines = ['14-day metric deltas (latest daily value vs personal baseline):'];
  for (const d of deltas) {
    const dir = d.latest >= d.mean ? 'above' : 'below';
    lines.push(
      d.sigma <= 1
        ? `  - ${label(d.metric)}: latest ${d.latest}, baseline ${d.mean} ±${d.stdev} → within ±1σ`
        : `  - ${label(d.metric)}: latest ${d.latest}, baseline ${d.mean} ±${d.stdev} → ${Math.abs(d.pct)}% ${dir} (${d.sigma.toFixed(1)}σ ${dir})`,
    );
  }
  return lines.join('\n');
}

export function buildSummaryInput(ctx: PetContext, deltas: Delta[]): VetSummaryInput {
  return {
    petName: ctx.pet.name,
    species: ctx.pet.species,
    breedName: ctx.pet.breedName,
    ageYears: ctx.pet.ageYears,
    weightLbs: ctx.pet.weightLbs,
    sex: ctx.pet.sex,
    windowDays: ctx.dataWindowDays,
    deltas,
    insights: ctx.recentInsights.map((i) => ({ urgency: i.urgency, summary: i.summary })),
    breed: ctx.breed
      ? {
          restingHrLow: ctx.breed.restingHrLow,
          restingHrHigh: ctx.breed.restingHrHigh,
          conditions: ctx.breed.conditions.map((c) => ({ condition: c.condition, typical_onset: c.typical_onset })),
          isGenericFallback: ctx.breed.isGenericFallback,
        }
      : null,
    containmentState: ctx.containment?.state ?? null,
  };
}

export async function summarizeForVet(
  db: Db,
  petId: string,
  metrics: VetReportMetricSeries[],
): Promise<{ text: string; mode: 'claude' | 'template' } | null> {
  const ctx = buildPetContext(db, petId);
  if (!ctx) return null;

  const deltas = computeDeltas(metrics);
  const text = await callClaude({
    system: SYSTEM,
    user: `${renderContext(ctx)}\n\n${renderDeltas(deltas)}`,
    maxTokens: 350,
  });
  if (text) return { text: text.trim(), mode: 'claude' };

  return { text: vetSummaryTemplate(buildSummaryInput(ctx, deltas)), mode: 'template' };
}
