import type { InsightType, Urgency } from '@connected-care/shared';
import { callClaude } from './claude';
import { narratorTemplate } from './fallback';

/**
 * Insight Narrator (PRD §7.3): a server-side writing step, not a chat surface.
 * Takes the engine's structured scoring output and produces the summary and
 * recommended_action stored on the insight record.
 */

export interface NarratorInput {
  insightType: InsightType;
  urgency: Urgency;
  metric: string;
  petName: string | null;
  deviceLabel: string | null;
  currentValue: number | null;
  baselineMean: number | null;
  deviationPct: number | null;
  durationDays: number;
  factors: string[];
  breedContext: string | null;
  siblingName: string | null;
  siblingDeviated: boolean | null;
  environmentNote: string | null;
}

export interface Narration {
  summary: string;
  recommendedAction: string;
  mode: 'claude' | 'template';
}

const SYSTEM = `You are the Insight Narrator for Connected Care, a pet health and safety platform.
You turn structured anomaly data into plain language a pet owner immediately understands.

Rules — follow every one:
- Ground every claim strictly in the input JSON. Never invent data about the pet.
- Output exactly two parts separated by the line "---": first a 2-3 sentence summary, then a single-sentence recommended action.
- Never diagnose. Frame health findings as "worth mentioning to your vet", not "your pet has X".
- urgent tier: the recommended action must include contacting a veterinarian.
- emergency tier: the summary's FIRST sentence must state the safety-relevant fact.
- info/monitor tiers: keep the tone light and reassuring.
- attention tier with an environmental explanation: calm, explanatory tone — not alarming.
- Equipment insights: focus on the device and the fix, not pet health.`;

export async function narrateInsight(input: NarratorInput): Promise<Narration> {
  const text = await callClaude({
    system: SYSTEM,
    user: JSON.stringify(input, null, 2),
    maxTokens: 400,
  });

  if (text) {
    const [summary, action] = text.split(/\n---\n?/);
    if (summary && action) {
      return { summary: summary.trim(), recommendedAction: action.trim(), mode: 'claude' };
    }
  }
  return { ...narratorTemplate(input), mode: 'template' };
}
