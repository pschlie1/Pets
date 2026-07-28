import type { AgentReply } from '@connected-care/shared';
import type { Db } from '../db/connection';
import { callClaude } from './claude';
import { buildPetContext, renderContext } from './context';
import { companionTemplate } from './fallback';

/**
 * Companion Agent (PRD §7.2): the conversational surface a pet owner talks to.
 * Grounded strictly in the household's own data via demo-tier context assembly.
 */

const SYSTEM_TEMPLATE = `You are the Connected Care companion — a warm, plain-spoken assistant that helps a pet owner understand their pet's health and safety data.

You may use ONLY the household data below. Guardrails, all mandatory:
- Never offer a diagnosis. Frame findings as "worth mentioning to your vet", never "your pet has X".
- If the conversation touches any insight at urgent or emergency tier, include a clear recommendation to contact their veterinarian in your response.
- Decline medication and dosing questions outright; redirect to the vet.
- When referencing patterns, state the data window (e.g. "based on the last 14 days").
- If the data below cannot answer the question, say so plainly. Never guess or invent readings.
- Keep answers to 2-4 sentences, friendly and concrete.

HOUSEHOLD DATA:
{{CONTEXT}}`;

/** Hard pre-check: dosing/medication questions never reach the model. */
const MEDICATION_RE = /\b(dose|dosage|dosing|how (much|many).{0,40}(mg|ml|milligram|pill|tablet)|benadryl|ibuprofen|tylenol|aspirin|acetaminophen|melatonin|trazodone|gabapentin|medicat\w*|prescri\w*)\b/i;

export async function answerQuestion(db: Db, petId: string, question: string): Promise<AgentReply | null> {
  const ctx = buildPetContext(db, petId);
  if (!ctx) return null;

  if (MEDICATION_RE.test(question)) {
    return {
      answer:
        `I can't help with medication or dosing questions — that's one for your veterinarian, who knows ${ctx.pet.name}'s full history. ` +
        `I'm glad to help with what the device data shows: activity, eating, drinking, sleep, and heart rate trends.`,
      mode: 'template',
      pet_id: petId,
      data_window_days: ctx.dataWindowDays,
    };
  }

  const system = SYSTEM_TEMPLATE.replace('{{CONTEXT}}', renderContext(ctx));
  const text = await callClaude({ system, user: question, maxTokens: 500 });

  return {
    answer: text ?? companionTemplate(ctx, question),
    mode: text ? 'claude' : 'template',
    pet_id: petId,
    data_window_days: ctx.dataWindowDays,
  };
}
