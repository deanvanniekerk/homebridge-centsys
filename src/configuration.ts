import { z } from 'zod';
import { CentsysError } from './errors.js';

const serialSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i)
  .transform((value) => value.toUpperCase());
const macSchema = z
  .union([z.literal(''), z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i)])
  .optional()
  .transform((value) => (value ? value.toUpperCase() : undefined));
const nameSchema = z
  .string()
  .max(64)
  .refine((value) => value.trim().length > 0)
  .transform((value) => value.trim());

const gateSchema = z
  .object({
    serialNumber: serialSchema,
    name: nameSchema.nullish().transform((value) => value ?? 'Gate'),
    macAddress: macSchema,
    enableControl: z.boolean().optional().default(false),
    controlProfile: z.unknown().optional(),
  })
  .superRefine((gate, context) => {
    if (gate.enableControl && (!gate.macAddress || gate.controlProfile !== 'd5-evo-smart-plus')) {
      context.addIssue({ code: 'custom', message: 'Unsupported control configuration' });
    }
  })
  .transform(
    (gate): GateConfig => ({
      name: gate.name,
      serialNumber: gate.serialNumber,
      enableControl: gate.enableControl,
      ...(gate.macAddress ? { macAddress: gate.macAddress } : {}),
    }),
  );

const configurationSchema = z.object({
  pollInterval: z
    .preprocess((value) => value ?? undefined, z.number().int().min(10).max(300).optional())
    .default(15),
  diagnosticLogging: z.boolean().optional().default(false),
  gates: z
    .preprocess(
      (value) => value ?? undefined,
      z
        .array(gateSchema)
        .max(10)
        .refine((gates) => new Set(gates.map((gate) => gate.serialNumber)).size === gates.length)
        .optional(),
    )
    .default([]),
});

export interface GateConfig {
  name: string;
  serialNumber: string;
  macAddress?: string;
  enableControl: boolean;
}

export interface CentsysConfig {
  pollInterval: number;
  diagnosticLogging: boolean;
  gates: GateConfig[];
}

export function gateIdentity(value: unknown): string {
  const result = serialSchema.safeParse(value);
  if (!result.success) throw new CentsysError('configuration');
  return result.data;
}

export function parseConfig(value: unknown): CentsysConfig {
  const result = configurationSchema.safeParse(value);
  if (!result.success) throw new CentsysError('configuration');
  return result.data;
}
