import { z } from 'zod';
import { SPECIES } from './enums';

/** The single telemetry envelope every device type posts through. */
export const telemetryEnvelopeSchema = z.object({
  device_id: z.string().min(1, 'device_id is required'),
  event_type: z.string().min(1, 'event_type is required'),
  occurred_at: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'occurred_at must be an ISO 8601 timestamp'),
  pet_id: z.string().nullable().optional(),
  payload: z.record(z.unknown()).default({}),
  schema_version: z.number().int().positive().default(1),
});
export type TelemetryEnvelope = z.infer<typeof telemetryEnvelopeSchema>;

export const createHouseholdSchema = z.object({
  location_city: z.string().min(1),
  location_state: z.string().min(1),
  location_zip: z.string().min(1),
  climate_zone: z.string().optional(),
});

export const createPetSchema = z.object({
  name: z.string().min(1),
  species: z.enum(SPECIES),
  breed_id: z.string().nullable().optional(),
  date_of_birth: z.string().optional(),
  weight_lbs: z.number().positive().optional(),
  sex: z.string().optional(),
});

export const patchPetSchema = createPetSchema.partial();

export const linkDeviceSchema = z.object({
  device_id: z.string().min(1),
});

export const agentQuerySchema = z.object({
  pet_id: z.string().min(1),
  question: z.string().min(1).max(2000),
});

export const loginSchema = z.object({
  email: z.string().email(),
});

export const vetShareSchema = z.object({
  recipient: z.string().min(1).max(200),
  method: z.enum(['portal', 'email', 'link']),
});

export const orderSchema = z.object({
  device_id: z.string().min(1),
  sku: z.string().min(1),
});
