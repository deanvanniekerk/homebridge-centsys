import { join } from "node:path";
import { CentsysError } from "./errors.js";
import { record } from "./protocol.js";

export const PLUGIN_NAME = "homebridge-centsys";
export const PLATFORM_NAME = "Centsys";
export const VERSION = "0.1.0-alpha.4";
export const storageDirectory = (root: string) => join(root, "centsys", "auth");

export interface GateConfig {
  name: string;
  serialNumber: string;
  macAddress?: string;
  enableControl: boolean;
}
export interface CentsysConfig {
  pollInterval: number;
  gates: GateConfig[];
}
export function gateIdentity(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{24}$/i.test(value))
    throw new CentsysError("configuration");
  return value.toUpperCase();
}
export function parseConfig(value: unknown): CentsysConfig {
  const row = record(value);
  const interval = row.pollInterval ?? 15;
  if (
    typeof interval !== "number" ||
    !Number.isInteger(interval) ||
    interval < 10 ||
    interval > 300
  )
    throw new CentsysError("configuration");
  const input = row.gates ?? [];
  if (!Array.isArray(input) || input.length > 10)
    throw new CentsysError("configuration");
  const gates = input.map((input): GateConfig => {
    const g = record(input);
    const serialNumber = gateIdentity(g.serialNumber);
    const name = g.name ?? "Gate";
    if (typeof name !== "string" || !name.trim() || name.length > 64)
      throw new CentsysError("configuration");
    if (g.enableControl !== undefined && typeof g.enableControl !== "boolean")
      throw new CentsysError("configuration");
    const enableControl = g.enableControl === true;
    let macAddress: string | undefined;
    if (g.macAddress !== undefined && g.macAddress !== "") {
      if (
        typeof g.macAddress !== "string" ||
        !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(g.macAddress)
      )
        throw new CentsysError("configuration");
      macAddress = g.macAddress.toUpperCase();
    }
    // Command profile is intentionally narrow; numeric product codes cannot identify the family.
    if (
      enableControl &&
      (!macAddress ||
        g.controlProfile !== "d5-evo-smart-plus" ||
        g.triggerModeConfirmed !== true)
    )
      throw new CentsysError("configuration");
    return {
      name: name.trim(),
      serialNumber,
      enableControl,
      ...(macAddress ? { macAddress } : {}),
    };
  });
  if (new Set(gates.map((g) => g.serialNumber)).size !== gates.length)
    throw new CentsysError("configuration");
  return { pollInterval: interval, gates };
}
