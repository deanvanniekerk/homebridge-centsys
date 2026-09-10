import { CentsysError } from "./errors.js";
import { record } from "./protocol.js";
import { gateIdentity } from "./settings.js";

/** One observed D5 Evo SMART+ mapping; a candidate, never proof of identity. */
export function wifiMacCandidate(input: unknown) {
  const row = record(input);
  if (
    row.model !== "d5-evo-smart-plus" ||
    row.modelConfirmed !== true ||
    typeof row.wifiMacAddress !== "string" ||
    !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(row.wifiMacAddress.trim())
  )
    throw new CentsysError("configuration");
  const serialNumber = gateIdentity(row.serialNumber);
  const hex = row.wifiMacAddress.trim().replaceAll(":", "");
  const bytes = Buffer.from(hex, "hex");
  const address = BigInt(`0x${hex}`);
  if ((bytes[0]! & 1) !== 0 || address === 0n || address > 0xfffffffffffdn)
    throw new CentsysError("configuration");
  const candidate = (address + 2n).toString(16).padStart(12, "0");
  return {
    serialNumber,
    macAddress: candidate.match(/.{2}/g)!.reverse().join(":").toUpperCase(),
  };
}
