import { CentsysError } from "./errors.js";

export const LIVE_REFRESH_MS = 20_000;
export const LIVE_EXPIRY_MS = 45_000;

export type Region = "za" | "au";
export type GateState =
  | "unknown"
  | "open"
  | "closed"
  | "partly-open"
  | "partly-closed"
  | "opening"
  | "closing";

export interface Device {
  serialNumber: string;
  productCode: number | null;
  productType: number | null;
  isWifiDevice: boolean | null;
  online: boolean | null;
}

export interface Overview {
  /** Local receipt of independently verified live controller telemetry, never HTTPS receipt. */
  liveVerifiedAt?: number;
  serialNumber: string;
  state: GateState;
  stateCode: number | null;
  powerSupplyCode: number | null;
  closingBeamCode: number | null;
  openingBeamCode: number | null;
  theftAlarmCode: number | null;
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CentsysError("protocol");
  }
  return value as Record<string, unknown>;
}

export function normalizeNumber(value: string): string {
  // Accept explicit international form only; do not guess a country or trunk prefix.
  if (!/^[+\d ()-]+$/.test(value)) throw new CentsysError("configuration");
  const number = value.replace(/[ ()-]/g, "").replace(/^00/, "+");
  if (!/^\+[1-9]\d{6,14}$/.test(number))
    throw new CentsysError("configuration");
  return number;
}

export function credential(value: unknown): string {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,16384}$/.test(value)) {
    throw new CentsysError("configuration");
  }
  return value;
}

function serial(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/.test(value)) {
    throw new CentsysError("protocol");
  }
  return value;
}

function integer(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new CentsysError("protocol");
  return value;
}

function boolean(value: unknown): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new CentsysError("protocol");
  return value;
}

function list<T extends { serialNumber: string }>(
  value: unknown,
  parse: (row: unknown) => T,
): T[] {
  if (!Array.isArray(value) || value.length > 256)
    throw new CentsysError("protocol");
  const rows = value.map(parse);
  if (new Set(rows.map((row) => row.serialNumber)).size !== rows.length)
    throw new CentsysError("protocol");
  return rows;
}

export function decodeDevices(value: unknown): Device[] {
  return list(value, (value) => {
    const row = record(value);
    const wifi =
      row.deviceWiFiStatus == null ? {} : record(row.deviceWiFiStatus);
    return {
      serialNumber: serial(row.serialNumber),
      productCode: integer(row.productCode),
      productType: integer(row.productType),
      isWifiDevice: boolean(row.isWifiDevice),
      online: boolean(wifi.isOnline),
    };
  });
}

export function decodeOverviews(
  value: unknown,
  requested: ReadonlySet<string>,
): Overview[] {
  const states: GateState[] = [
    "unknown",
    "open",
    "closed",
    "partly-open",
    "partly-closed",
    "opening",
    "closing",
  ];
  return list(value, (value) => {
    const row = record(value);
    const id = serial(row.operatorSerialNumber);
    if (!requested.has(id)) throw new CentsysError("protocol");
    const code = integer(row.operatorStatus);
    return {
      serialNumber: id,
      state: code === null ? "unknown" : (states[code] ?? "unknown"),
      stateCode: code,
      powerSupplyCode: integer(row.powerSupplyStatus),
      closingBeamCode: integer(row.closingBeamStatus),
      openingBeamCode: integer(row.openingBeamStatus),
      theftAlarmCode: integer(row.theftAlarmState),
    };
  });
}
