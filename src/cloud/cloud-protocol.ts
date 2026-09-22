import { z } from 'zod';
import type { ErrorDiagnostic } from '../errors.js';
import { CentsysError } from '../errors.js';
import type { Device, GateState, Overview } from '../gate/gate-model.js';

export type Region = 'za' | 'au';
export const regionSchema = z.enum(['za', 'au']);
const recordSchema = z.record(z.string(), z.unknown());
const sourceNumberSchema = z.string().regex(/^[+\d ()-]+$/);
const normalizedNumberSchema = z.string().regex(/^\+[1-9]\d{6,14}$/);
const credentialSchema = z.string().regex(/^[\x21-\x7e]{1,16384}$/);
const serialSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
const integerSchema = z.number().refine(Number.isSafeInteger);
const booleanSchema = z.boolean();
const responseRowsSchema = z.array(z.unknown()).max(256);

export function record(value: unknown): Record<string, unknown> {
  const result = recordSchema.safeParse(value);
  if (!result.success) {
    throw new CentsysError('protocol', { reason: 'expected-record' });
  }
  return result.data;
}

export function normalizeNumber(value: string): string {
  // Accept explicit international form only; do not guess a country or trunk prefix.
  if (!sourceNumberSchema.safeParse(value).success) throw new CentsysError('configuration');
  const number = value.replace(/[ ()-]/g, '').replace(/^00/, '+');
  if (!normalizedNumberSchema.safeParse(number).success) throw new CentsysError('configuration');
  return number;
}

export function credential(value: unknown): string {
  const result = credentialSchema.safeParse(value);
  if (!result.success) {
    throw new CentsysError('configuration');
  }
  return result.data;
}

export function decodeOtpSent(value: unknown): void {
  if (!z.literal(true).safeParse(value).success) throw new CentsysError('otp-not-sent');
}

export function decodeOtpToken(value: unknown): string {
  const response = record(value).response;
  if (response === '') throw new CentsysError('otp-rejected');
  const parsed = z.string().safeParse(response);
  if (!parsed.success) throw new CentsysError('protocol');
  try {
    return credential(parsed.data);
  } catch {
    throw new CentsysError('protocol');
  }
}

const certificateSchema = z.object({
  pfx: z
    .string()
    .min(4)
    .max(131_072)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => value.length % 4 === 0),
  password: z.string().max(4096),
});

export function decodeCertificate(value: unknown): { pfx: Buffer; password: string } {
  const data = record(value);
  const fields = Object.fromEntries(
    Object.entries(data).map(([key, field]) => [key.toLowerCase(), field]),
  );
  const parsed = certificateSchema.safeParse({
    pfx: fields.certificatepfxbase64 ?? fields.pfxbase64,
    password: fields.certificatepassword ?? fields.password ?? '',
  });
  if (!parsed.success) throw new CentsysError('protocol', { reason: 'invalid-certificate' });
  return { pfx: Buffer.from(parsed.data.pfx, 'base64'), password: parsed.data.password };
}

function serial(value: unknown, field: NonNullable<ErrorDiagnostic['field']>): string {
  const result = serialSchema.safeParse(value);
  if (!result.success) {
    throw new CentsysError('protocol', {
      reason: 'invalid-serial',
      field,
    });
  }
  return result.data;
}

function integer(value: unknown, field: NonNullable<ErrorDiagnostic['field']>): number | null {
  if (value === undefined || value === null) return null;
  const result = integerSchema.safeParse(value);
  if (!result.success) throw new CentsysError('protocol', { reason: 'expected-integer', field });
  return result.data;
}

function boolean(value: unknown, field: NonNullable<ErrorDiagnostic['field']>): boolean | null {
  if (value === undefined || value === null) return null;
  const result = booleanSchema.safeParse(value);
  if (!result.success) throw new CentsysError('protocol', { reason: 'expected-boolean', field });
  return result.data;
}

function list<T extends { serialNumber: string }>(value: unknown, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new CentsysError('protocol', { reason: 'expected-list' });
  const result = responseRowsSchema.safeParse(value);
  if (!result.success) throw new CentsysError('protocol', { reason: 'too-many-rows' });
  const rows = result.data.map(parse);
  if (new Set(rows.map((row) => row.serialNumber)).size !== rows.length)
    throw new CentsysError('protocol', { reason: 'duplicate-identity' });
  return rows;
}

function discoveryMac(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(text)) return text.toUpperCase();
  // Formatting only: preserve byte order and value.
  if (/^[0-9a-f]{12}$/i.test(text)) return text.match(/.{2}/g)!.join(':').toUpperCase();
  return undefined;
}

export function decodeDevices(value: unknown): Device[] {
  return list(value, (value) => {
    const row = record(value);
    const wifi = row.deviceWiFiStatus == null ? {} : record(row.deviceWiFiStatus);
    const macAddress = discoveryMac(row.macAddress);
    return {
      ...(macAddress ? { macAddress } : {}),
      serialNumber: serial(row.serialNumber, 'serialNumber'),
      productCode: integer(row.productCode, 'productCode'),
      productType: integer(row.productType, 'productType'),
      isWifiDevice: boolean(row.isWifiDevice, 'isWifiDevice'),
      online: boolean(wifi.isOnline, 'isOnline'),
    };
  });
}

export function decodeOverviews(value: unknown, requested: ReadonlySet<string>): Overview[] {
  const states: GateState[] = [
    'unknown',
    'open',
    'closed',
    'partly-open',
    'partly-closed',
    'opening',
    'closing',
  ];
  return list(value, (value) => {
    const row = record(value);
    const id = serial(row.operatorSerialNumber, 'operatorSerialNumber');
    if (!requested.has(id)) throw new CentsysError('protocol', { reason: 'unexpected-identity' });
    const code = integer(row.operatorStatus, 'operatorStatus');
    return {
      serialNumber: id,
      state: code === null ? 'unknown' : (states[code] ?? 'unknown'),
      stateCode: code,
      powerSupplyCode: integer(row.powerSupplyStatus, 'powerSupplyStatus'),
      closingBeamCode: integer(row.closingBeamStatus, 'closingBeamStatus'),
      openingBeamCode: integer(row.openingBeamStatus, 'openingBeamStatus'),
      theftAlarmCode: integer(row.theftAlarmState, 'theftAlarmState'),
    };
  });
}
