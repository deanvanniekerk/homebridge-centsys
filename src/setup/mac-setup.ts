import { z } from 'zod';
import { record } from '../cloud/cloud-protocol.js';
import { gateIdentity } from '../configuration.js';
import { CentsysError } from '../errors.js';

const wifiCandidateSchema = z.object({
  model: z.literal('d5-evo-smart-plus'),
  modelConfirmed: z.literal(true),
  wifiMacAddress: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i)),
  serialNumber: z.unknown(),
});

/** One observed D5 Evo SMART+ mapping; a candidate, never proof of identity. */
export function wifiMacCandidate(input: unknown) {
  const parsed = wifiCandidateSchema.safeParse(record(input));
  if (!parsed.success) throw new CentsysError('configuration');
  const row = parsed.data;
  const serialNumber = gateIdentity(row.serialNumber);
  const hex = row.wifiMacAddress.replaceAll(':', '');
  const bytes = Buffer.from(hex, 'hex');
  const address = BigInt(`0x${hex}`);
  if ((bytes[0]! & 1) !== 0 || address === 0n || address > 0xfffffffffffdn)
    throw new CentsysError('configuration');
  const candidate = (address + 2n).toString(16).padStart(12, '0');
  return {
    serialNumber,
    macAddress: candidate.match(/.{2}/g)!.reverse().join(':').toUpperCase(),
  };
}
