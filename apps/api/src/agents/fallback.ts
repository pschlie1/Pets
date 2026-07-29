import type { NarratorInput } from './narrator';
import type { PetContext } from './context';

/**
 * Deterministic, data-grounded fallback templates. Used whenever the Claude
 * API is unavailable (no key, network error) so the demo never breaks.
 * Every sentence interpolates real values from the same context the live
 * agent would see — grounded, just not generated.
 */

export const METRIC_LABELS: Record<string, string> = {
  resting_heart_rate: 'resting heart rate',
  walk_minutes: 'daily walk time',
  water_intake_ml: 'water intake',
  food_intake_g: 'food intake',
  sleep_hours: 'sleep',
  feeder_schedule_drift_min: 'feeding schedule',
  fountain_flow_rate: 'fountain flow rate',
  boundary_safety: 'boundary safety',
  containment_signal: 'collar signal',
  collar_battery_pct: 'collar battery',
};

export function label(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replace(/_/g, ' ');
}

/** Structured input for the vet summary template — mirrors what Claude sees. */
export interface VetSummaryInput {
  petName: string;
  species: string;
  breedName: string | null;
  ageYears: number | null;
  weightLbs: number | null;
  sex: string | null;
  windowDays: number;
  deltas: {
    metric: string;
    latest: number;
    mean: number;
    stdev: number;
    sigma: number;
    pct: number;
    status: string;
  }[];
  insights: { urgency: string; summary: string }[];
  breed: {
    restingHrLow: number;
    restingHrHigh: number;
    conditions: { condition: string; typical_onset: string }[];
    isGenericFallback: boolean;
  } | null;
  containmentState: string | null;
}

/**
 * Deterministic vet summary: neutral clinical register, every number
 * interpolated from real data, explicitly not a diagnosis.
 */
export function vetSummaryTemplate(input: VetSummaryInput): string {
  const { petName } = input;
  const sentences: string[] = [];

  const age = input.ageYears !== null ? `${input.ageYears}-year-old ` : '';
  const sex = input.sex ? `${input.sex} ` : '';
  const breed = input.breedName ?? `${input.species} (breed not specified)`;
  const weight = input.weightLbs !== null ? `, ${input.weightLbs} lbs` : '';
  sentences.push(
    `${petName} is a ${age}${sex}${breed}${weight}. ` +
      `This summary covers device-recorded patterns from the last ${input.windowDays} days of consumer monitoring devices; it is not a diagnosis.`,
  );

  const established = input.deltas.filter((d) => d.status === 'established');
  const deviating = established.filter((d) => d.sigma > 1);
  const insufficient = input.deltas.filter((d) => d.status !== 'established');

  if (deviating.length > 0) {
    for (const d of deviating) {
      const dir = d.latest >= d.mean ? 'above' : 'below';
      const name = label(d.metric);
      const round = (v: number) => Math.round(v * 10) / 10;
      sentences.push(
        `${name.charAt(0).toUpperCase()}${name.slice(1)} is currently ${round(d.latest)} against a personal baseline of ${round(d.mean)} (±${round(d.stdev)}), ` +
          `${Math.abs(d.pct)}% ${dir} baseline (${d.sigma.toFixed(1)} standard deviations).`,
      );
    }
  } else if (established.length > 0) {
    sentences.push(
      `All monitored metrics — ${established.map((d) => label(d.metric)).join(', ')} — are currently within one standard deviation of ${petName}'s personal baselines.`,
    );
  }
  if (insufficient.length > 0) {
    sentences.push(
      `${insufficient.map((d) => label(d.metric)).join(', ')} ${insufficient.length === 1 ? 'lacks' : 'lack'} a reliable baseline (insufficient data) and ${insufficient.length === 1 ? 'is' : 'are'} not interpreted here.`,
    );
  }

  if (input.insights.length > 0) {
    const top = input.insights[0];
    sentences.push(
      `There ${input.insights.length === 1 ? 'is 1 active system insight' : `are ${input.insights.length} active system insights`}; the highest is at the ${top.urgency} tier: ${top.summary}`,
    );
  } else {
    sentences.push('There are no active system insights.');
  }

  if (input.breed) {
    const conditions = input.breed.conditions
      .map((c) => `${c.condition} (${c.typical_onset})`)
      .join('; ');
    sentences.push(
      `Breed reference resting heart rate range: ${input.breed.restingHrLow}–${input.breed.restingHrHigh} bpm.` +
        (conditions ? ` Predispositions on file: ${conditions}.` : '') +
        (input.breed.isGenericFallback
          ? ' Note: reference values use a species-generic profile (reduced confidence).'
          : ''),
    );
  }

  if (input.containmentState && input.containmentState !== 'protected') {
    sentences.push(
      input.containmentState === 'breach'
        ? `Containment note: the pet is currently reported outside the containment boundary.`
        : `Containment note: the containment collar has not checked in recently; boundary status is unverified.`,
    );
  }

  return sentences.join(' ');
}

export function narratorTemplate(input: NarratorInput): { summary: string; recommendedAction: string } {
  const name = input.petName ?? 'Your pet';
  const dir = (input.deviationPct ?? 0) >= 0 ? 'above' : 'below';
  const pct = Math.abs(Math.round(input.deviationPct ?? 0));
  const days = input.durationDays;

  if (input.urgency === 'emergency') {
    return {
      summary:
        `${name} has crossed the containment boundary and has shown no movement outside the safe zone. ` +
        `This needs your attention right now — whether the cause is a health event or a device failure, the situation is the same. ` +
        `Your local dealer associate has been alerted in parallel.`,
      recommendedAction: `Go to ${name} now, and call your emergency vet contact if ${name} is unresponsive.`,
    };
  }

  // Containment-specific templates come before the generic tier branches.
  if (input.metric === 'containment_signal') {
    const mins = input.currentValue !== null ? `${Math.round(input.currentValue)} minutes` : 'a while';
    return {
      summary:
        `${name}'s collar hasn't checked in for ${mins}, so the yard boundary can't be verified right now. ` +
        `This is usually a charging or placement issue — but until check-ins resume, treat the fence as unverified rather than assume all is well.`,
      recommendedAction: `Check that the collar is on ${name}, charged, and in range — and keep ${name} supervised outdoors until the signal returns.`,
    };
  }

  if (input.metric === 'boundary_safety' && input.urgency === 'monitor') {
    const mins = input.currentValue !== null ? `about ${Math.round(input.currentValue)} minutes` : 'a few minutes';
    return {
      summary:
        `${name} stepped past the boundary for ${mins} but kept moving the whole time and returned to the safe zone unaided. ` +
        `No alarm needed — logged so a repeating pattern would stand out.`,
      recommendedAction: `No action needed — if brief excursions keep happening, a boundary-width adjustment is worth a look.`,
    };
  }

  if (input.metric === 'collar_battery_pct' && input.urgency === 'urgent') {
    const pct = input.currentValue !== null ? `${Math.round(input.currentValue)}%` : 'critically low';
    return {
      summary:
        `The ${input.deviceLabel ?? 'containment collar'} battery is at ${pct}. ` +
        `Below this level, boundary corrections may not deliver — this is a safety gap, not just maintenance.`,
      recommendedAction: `Charge or swap the collar battery today, and keep the yard supervised until it's back above 20%.`,
    };
  }

  if (input.insightType === 'equipment') {
    const dev = input.deviceLabel ?? 'A device';
    if (input.urgency === 'attention') {
      return {
        summary:
          `${dev} is showing a real wear pattern: ${label(input.metric)} has declined about ${pct}% over ${days} days. ` +
          `This looks like routine maintenance, not a pet health signal.`,
        recommendedAction: `Order a replacement filter or schedule a quick service check for the ${dev.toLowerCase()}.`,
      };
    }
    return {
      summary:
        `${dev} drifted slightly on ${label(input.metric)} — noticed, logged, and not yet a pattern worth your time. ` +
        `We'll keep watching it on the next review cycle.`,
      recommendedAction: 'No action needed — we will flag it if the drift becomes a trend.',
    };
  }

  if (input.urgency === 'urgent') {
    const sibling =
      input.siblingName && input.siblingDeviated === false
        ? ` ${input.siblingName}'s readings stay normal over the same period, which rules out a shared household cause.`
        : '';
    const breed = input.breedContext ? ` ${input.breedContext}` : '';
    return {
      summary:
        `${name}'s ${label(input.metric)} has run ${pct}% ${dir} ${name === 'Meeko' ? 'his' : 'their'} own baseline for ${days} days.` +
        sibling +
        breed,
      recommendedAction: `Schedule a vet visit and mention the ${label(input.metric)} trend — this pattern is worth a professional look.`,
    };
  }

  if (input.urgency === 'attention') {
    const env = input.environmentNote ? ` ${input.environmentNote}` : '';
    return {
      summary:
        `${name}'s ${label(input.metric)} is running ${pct}% ${dir} the usual range.` +
        env +
        ` Nothing alarming — this is the kind of change worth keeping an eye on.`,
      recommendedAction: `Keep fresh water available and watch ${name}'s ${label(input.metric)} over the next few days.`,
    };
  }

  if (input.urgency === 'monitor') {
    return {
      summary: `${name}'s ${label(input.metric)} showed a small deviation — a single reading, no pattern yet. Logged for the next check.`,
      recommendedAction: 'No action needed — we will re-check automatically on the next cycle.',
    };
  }

  return {
    summary: `${name}'s ${label(input.metric)} ran ${pct}% ${dir} baseline — comfortably within the normal range for ${name} and the breed.`,
    recommendedAction: 'Nothing to do — all normal.',
  };
}

/**
 * Companion fallback: keyword-matches the question and answers from real
 * context data, always stating the data window.
 */
export function companionTemplate(ctx: PetContext, question: string): string {
  const q = question.toLowerCase();
  const name = ctx.pet.name;
  const windowNote = `(based on the last ${ctx.dataWindowDays} days of device data)`;

  const baseline = (metric: string) => ctx.baselines.find((b) => b.metric === metric);
  const urgentInsights = ctx.recentInsights.filter((i) => i.urgency === 'urgent' || i.urgency === 'emergency');
  const vetNote =
    urgentInsights.length > 0
      ? ` Because there is an active ${urgentInsights[0].urgency} insight for ${name}, please contact your veterinarian to discuss it. You can open a shareable vet report from ${name}'s profile page.`
      : '';

  if (/fence|boundary|yard|collar|contain|safe zone|escape/.test(q)) {
    const c = ctx.containment;
    if (c) {
      if (c.state === 'breach') {
        return `${name} is outside the safe zone right now — please go check on ${name} immediately. Your local dealer associate has been alerted in parallel with this notification.`;
      }
      if (c.state === 'signal_lost') {
        return `${name}'s collar hasn't checked in for ${c.minutesSinceCheckIn ?? 'many'} minutes, so I can't verify the boundary right now. Check the collar is on, charged, and in range — and keep ${name} supervised outdoors until the signal returns.`;
      }
      const battery = c.batteryPct !== null ? ` The collar battery is at ${c.batteryPct}%.` : '';
      return `The fence is doing its job — ${name} is inside the safe zone, and the collar checked in ${c.minutesSinceCheckIn ?? 0} minutes ago.${battery} I'll speak up the moment that changes.${vetNote}`;
    }
  }
  if (/heart|hr\b|bpm|cardiac/.test(q)) {
    const b = baseline('resting_heart_rate');
    if (b) {
      const breedNote = ctx.breed
        ? ` The typical range for ${ctx.pet.breedName ?? `a ${ctx.pet.species}`} is ${ctx.breed.restingHrLow}-${ctx.breed.restingHrHigh} bpm.`
        : '';
      const related = ctx.recentInsights.find((i) => i.metric === 'resting_heart_rate');
      const insightNote = related ? ` Recent note: ${related.summary}` : ` Readings have stayed close to that baseline.`;
      return `${name}'s resting heart rate baseline is ${Math.round(b.mean)} bpm ${windowNote}.${breedNote}${insightNote}${vetNote}`;
    }
  }
  if (/water|drink|hydrat|fountain/.test(q)) {
    const b = baseline('water_intake_ml');
    if (b) {
      const related = ctx.recentInsights.find((i) => i.metric === 'water_intake_ml');
      return `${name} drinks about ${Math.round(b.mean)} ml of water a day ${windowNote}.${related ? ` Recent note: ${related.summary}` : ' Intake has been steady.'}${vetNote}`;
    }
  }
  if (/food|eat|feed|appetite/.test(q)) {
    const b = baseline('food_intake_g');
    if (b) {
      return `${name} eats about ${Math.round(b.mean)} g a day across scheduled feedings ${windowNote}. Appetite has been consistent.${vetNote}`;
    }
  }
  if (/walk|activity|exercise|active/.test(q)) {
    const b = baseline('walk_minutes');
    if (b) {
      const related = ctx.recentInsights.find((i) => i.metric === 'walk_minutes');
      return `${name} averages about ${Math.round(b.mean)} minutes of walks a day ${windowNote}.${related ? ` Recent note: ${related.summary}` : ''}${vetNote}`;
    }
  }
  if (/sleep|rest\b/.test(q)) {
    const b = baseline('sleep_hours');
    if (b) {
      return `${name} sleeps about ${b.mean.toFixed(1)} hours a night ${windowNote}, which is healthy and steady.${vetNote}`;
    }
  }
  if (/how is|how'?s|doing|okay|ok\b|worried|health/.test(q)) {
    if (urgentInsights.length > 0) {
      return `There is something worth your attention: ${urgentInsights[0].summary} Please contact your veterinarian to discuss it — this is pattern detection from device data ${windowNote}, not a diagnosis. You can open a shareable vet report from ${name}'s profile page to bring the data with you.`;
    }
    const attention = ctx.recentInsights.find((i) => i.urgency === 'attention');
    if (attention) {
      return `${name} is doing well overall. One thing we're keeping an eye on: ${attention.summary} ${windowNote}`;
    }
    return `${name} is doing great — heart rate, activity, eating, and drinking all read normal against ${name}'s own baseline ${windowNote}. 🐾`;
  }

  return (
    `I can answer questions about ${name}'s heart rate, activity, eating, drinking, and sleep — all grounded in the household's device data ${windowNote}. ` +
    `I don't have data beyond those metrics, so for anything else your vet is the right call.${vetNote}`
  );
}
