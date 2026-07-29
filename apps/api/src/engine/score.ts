import type { PeaceOfMindScore, ScoreBand, Urgency } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { getContainmentStatus } from './containment';

/**
 * Peace-of-Mind score: one 0-100 household read of "how covered are we right
 * now". Pure deductions from the same signals the rest of the app shows, so
 * the score can never disagree with the screens under it.
 */

const INSIGHT_DEDUCTION: Partial<Record<Urgency, number>> = {
  emergency: 40,
  urgent: 20,
  attention: 8,
  monitor: 3,
};

function band(score: number): ScoreBand {
  if (score >= 90) return 'protected';
  if (score >= 70) return 'good';
  if (score >= 40) return 'needs_attention';
  return 'act_now';
}

export function getPeaceOfMindScore(db: Db, householdId: string, now: number = Date.now()): PeaceOfMindScore {
  const factors: { label: string; delta: number }[] = [];
  let score = 100;

  // Active (unresolved) insights, worst first.
  const insights = db
    .prepare(
      `SELECT urgency, summary FROM insights
       WHERE household_id = ? AND acknowledged_status IN ('unseen', 'seen')`,
    )
    .all(householdId) as { urgency: Urgency; summary: string }[];
  for (const i of insights) {
    const deduction = INSIGHT_DEDUCTION[i.urgency];
    if (!deduction) continue;
    score -= deduction;
    factors.push({ label: `${i.urgency === 'emergency' ? '🚨' : '⚠️'} ${i.summary}`, delta: -deduction });
  }

  // Containment posture (breaches already deduct via their emergency insight,
  // so only the degraded state adds here to avoid double-counting).
  const containment = getContainmentStatus(db, householdId, now);
  if (containment.overall === 'degraded') {
    score -= 15;
    factors.push({ label: '🛡️ Containment coverage degraded — a collar needs attention', delta: -15 });
  }

  // Equipment readiness.
  const devices = db
    .prepare(
      `SELECT model, device_type, status FROM devices
       WHERE household_id = ? AND deleted_at IS NULL AND status != 'active'`,
    )
    .all(householdId) as { model: string | null; device_type: string; status: string }[];
  for (const d of devices) {
    score -= 8;
    factors.push({ label: `🔧 ${d.model ?? d.device_type} is ${d.status.replace('_', ' ')}`, delta: -8 });
  }

  score = Math.max(0, Math.min(100, score));
  if (factors.length === 0) {
    factors.push({ label: '💚 Every device is online and every trend is on baseline', delta: 0 });
  }

  return { household_id: householdId, score, band: band(score), factors };
}
