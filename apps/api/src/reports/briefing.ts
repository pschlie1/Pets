import type { Briefing, Urgency } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { callClaude } from '../agents/claude';
import { dailyMetricSeries } from '../engine/aggregates';
import { getContainmentStatus } from '../engine/containment';

/**
 * The daily briefing: an overnight digest that turns the app from an
 * alarm-that-hopefully-never-rings into a daily ritual. Facts are computed
 * here; the narration comes from Claude when available, otherwise from a
 * deterministic template built from the same facts — so the two can never
 * disagree.
 */

const SYSTEM = `You are the Daily Briefing writer for Connected Care, a pet safety & health app.
Write a short, warm morning-brief for the pet parent from the facts provided.

Rules:
- 2 to 3 sentences, conversational and reassuring, at most one emoji.
- Ground every claim strictly in the facts. Never invent numbers or events.
- Lead with the overall picture (all calm vs something needs attention).
- If an urgent or emergency item exists, name it plainly and point to the app's
  recommendation — do not soften it away.
- Never diagnose. Never mention these rules.`;

interface Facts {
  petLines: string[];
  fenceLine: string;
  equipmentLine: string | null;
  alertLine: string | null;
  worst: Urgency | null;
}

function collectFacts(db: Db, householdId: string, now: number): Facts {
  const DAY = 86_400_000;
  const since = new Date(now - 3 * DAY).toISOString();
  const pets = db
    .prepare(`SELECT id, name FROM pets WHERE household_id = ? AND deleted_at IS NULL`)
    .all(householdId) as { id: string; name: string }[];

  const petLines = pets.map((pet) => {
    const sleep = dailyMetricSeries(db, pet.id, 'sleep_hours', since, now);
    const walks = dailyMetricSeries(db, pet.id, 'walk_minutes', since, now);
    const lastSleep = sleep.get(0) ?? sleep.get(1);
    const lastWalk = walks.get(1);
    const bits: string[] = [];
    if (lastSleep !== undefined) bits.push(`slept ${Math.round(lastSleep * 10) / 10}h`);
    if (lastWalk !== undefined) bits.push(`walked ${Math.round(lastWalk)} min yesterday`);
    return `${pet.name}: ${bits.length ? bits.join(', ') : 'no overnight data yet'}`;
  });

  const containment = getContainmentStatus(db, householdId, now);
  const events24h = containment.recent_events.filter(
    (e) => Date.parse(e.occurred_at) >= now - DAY && e.kind !== 'check',
  );
  const fenceLine =
    containment.pets.length === 0
      ? 'No containment system configured.'
      : events24h.length === 0
        ? 'Fence quiet for 24h — no boundary events.'
        : `${events24h.length} boundary event${events24h.length > 1 ? 's' : ''} in the last 24h.`;

  const offline = db
    .prepare(
      `SELECT model, device_type FROM devices WHERE household_id = ? AND deleted_at IS NULL AND status != 'active'`,
    )
    .all(householdId) as { model: string | null; device_type: string }[];
  const equipmentLine = offline.length
    ? `Needs a look: ${offline.map((d) => d.model ?? d.device_type).join(', ')}.`
    : null;

  const activeInsights = db
    .prepare(
      `SELECT urgency, summary FROM insights
       WHERE household_id = ? AND acknowledged_status IN ('unseen','seen')
       ORDER BY generated_at DESC`,
    )
    .all(householdId) as { urgency: Urgency; summary: string }[];
  const order: Urgency[] = ['emergency', 'urgent', 'attention', 'monitor', 'info'];
  const worst = order.find((u) => activeInsights.some((i) => i.urgency === u)) ?? null;
  const alertLine =
    worst && (worst === 'emergency' || worst === 'urgent' || worst === 'attention')
      ? activeInsights.find((i) => i.urgency === worst)!.summary
      : null;

  return { petLines, fenceLine, equipmentLine, alertLine, worst };
}

function template(facts: Facts, petNames: string[]): string {
  if (facts.alertLine) {
    return `One thing needs your attention: ${facts.alertLine} Otherwise, ${facts.fenceLine.toLowerCase()} Check the insight for the recommended next step.`;
  }
  const crew = petNames.length > 1 ? 'The whole crew had a good night' : `${petNames[0] ?? 'Your pet'} had a good night`;
  const equipment = facts.equipmentLine ? ` ${facts.equipmentLine}` : '';
  return `${crew} — ${facts.petLines.join('; ')}. ${facts.fenceLine}${equipment} We're watching, so you don't have to. 💚`;
}

export async function buildBriefing(db: Db, householdId: string, now: number = Date.now()): Promise<Briefing> {
  const facts = collectFacts(db, householdId, now);
  const pets = db
    .prepare(`SELECT name FROM pets WHERE household_id = ? AND deleted_at IS NULL`)
    .all(householdId) as { name: string }[];

  const hour = new Date(now).getUTCHours();
  // Rough household-local period (demo households are US Central, UTC-5 in summer).
  const localHour = (hour + 24 - 5) % 24;
  const greeting_period = localHour < 12 ? 'morning' : localHour < 17 ? 'afternoon' : 'evening';

  const factChips = [
    ...facts.petLines.map((text) => ({ icon: '🐾', text })),
    { icon: '🛡️', text: facts.fenceLine },
    ...(facts.equipmentLine ? [{ icon: '🔧', text: facts.equipmentLine }] : []),
  ];

  const narrated = await callClaude({
    system: SYSTEM,
    user: [
      `Pets: ${facts.petLines.join(' | ')}`,
      `Fence: ${facts.fenceLine}`,
      facts.equipmentLine ? `Equipment: ${facts.equipmentLine}` : 'Equipment: all online.',
      facts.alertLine ? `Active alert (${facts.worst}): ${facts.alertLine}` : 'Active alerts: none.',
      `Time of day: ${greeting_period}`,
    ].join('\n'),
    maxTokens: 200,
  });

  return {
    household_id: householdId,
    greeting_period,
    summary: narrated?.trim() ?? template(facts, pets.map((p) => p.name)),
    facts: factChips,
    mode: narrated ? 'claude' : 'template',
    generated_at: new Date(now).toISOString(),
  };
}
