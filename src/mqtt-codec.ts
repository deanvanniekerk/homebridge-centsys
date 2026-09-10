import { CentsysError } from "./errors.js";
import { normalizeNumber } from "./protocol.js";
import type { GateState } from "./protocol.js";

// Adapted from the pinned MIT reference; see THIRD_PARTY_NOTICES.md.
const baseKey = Buffer.from("38983fba4dbfab9c", "hex");
function key(mac: string): Buffer {
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac))
    throw new CentsysError("configuration");
  const first = Buffer.from(mac.replaceAll(":", ""), "hex");
  return Buffer.from(baseKey.map((v, i) => (i < 4 ? v ^ first[i]! : v)));
}
function xor(body: Buffer, mac: string): Buffer {
  const k = key(mac);
  return Buffer.from(body.map((v, i) => v ^ k[i % 8]!));
}
function packet(type: number, body: Buffer, mac: string): Buffer {
  return Buffer.concat([Buffer.from([1, 1, type, 0]), xor(body, mac)]);
}
export function identityPacket(phone: string, mac: string): Buffer {
  const digits = normalizeNumber(phone).slice(1);
  const parts = [0, 0, 0];
  for (let i = 0; i < digits.length; i++) {
    const group = 2 - Math.floor(i / 8);
    parts[group] =
      (parts[group]! |
        (Number(digits[digits.length - i - 1]) << ((7 - (i % 8)) * 4))) >>>
      0;
  }
  const body = Buffer.alloc(12);
  parts.forEach((v, i) => body.writeUInt32LE(v, i * 4));
  return packet(1, body, mac);
}
export function timePacket(mac: string, now = new Date()): Buffer {
  // This initial command profile is restricted to South Africa, including DST-independent time.
  const local = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return packet(
    5,
    Buffer.from([
      local.getUTCSeconds(),
      local.getUTCMinutes(),
      local.getUTCHours(),
      (local.getUTCDay() + 6) % 7,
      local.getUTCDate(),
      local.getUTCMonth(),
      local.getUTCFullYear() - 2000,
      0,
    ]),
    mac,
  );
}
export function triggerPacket(
  mac: string,
  challenge: Buffer,
  configVersion = 0,
): Buffer {
  if (
    !Number.isInteger(configVersion) ||
    configVersion < 0 ||
    configVersion > 255
  )
    throw new CentsysError("configuration");
  if (challenge.length !== 4) throw new CentsysError("protocol");
  // Profile: D5 Evo SMART+ TRG only. No garage RUN or lock commands.
  return Buffer.concat([
    packet(3, Buffer.from([configVersion, 0, 34, 0]), mac),
    challenge,
  ]);
}
export function isResponse(data: Buffer, type: number): boolean {
  return (
    data.length >= 4 &&
    data.length <= 128 &&
    data[0] === 1 &&
    data[1] === 1 &&
    data[2] === type &&
    // D5 Evo SMART+ 2.1.0.0 returns an eight-byte cmd-06 envelope
    // with byte 3 set to 0x20. This identifies a time reply, not proof
    // of activation. The observed status-1 identity reply uses 0x87;
    // challengeFrom also validates the decoded identity status.
    (data[3] === 0 ||
      (type === 6 && data[3] === 0x20 && data.length === 8) ||
      (type === 2 && data[3] === 0x87 && data.length === 12))
  );
}
export function challengeFrom(data: Buffer, mac: string): Buffer {
  if (!isResponse(data, 2) || data.length !== 12)
    throw new CentsysError("protocol");
  const status = xor(data.subarray(4, 8), mac);
  if (status[0] !== 1) throw new CentsysError("gate-authentication");
  if (status.subarray(1).some((v) => v !== 0))
    throw new CentsysError("protocol");
  return Buffer.from(data.subarray(-4));
}
export interface ActivationResponse {
  code: number;
  configVersion: number;
}
export function decodeActivationResponse(
  data: Buffer,
  mac: string,
): ActivationResponse {
  if (!isResponse(data, 4) || data.length < 6)
    throw new CentsysError("protocol");
  const body = xor(data.subarray(4), mac);
  return { code: body[1]!, configVersion: body[0]! };
}

export interface LiveState {
  state: GateState;
  batteryVoltage: number;
  obstruction: boolean | null;
  inhibited: boolean;
}
export function decodeGateTelemetry(data: Buffer): LiveState {
  // Only the known D5 Evo layout: 36-byte body, optionally zero-padded to 64.
  if (data.length !== 40 && data.length !== 68)
    throw new CentsysError("protocol");
  if (data.length === 68 && data.subarray(40).some((v) => v !== 0))
    throw new CentsysError("protocol");
  const b = data.subarray(4);
  const states: GateState[] = [
    "open",
    "closed",
    "partly-open",
    "partly-closed",
    "opening",
    "closing",
  ];
  const state = states[b[22]!] ?? "unknown";
  const flags = BigInt(b.readUInt32LE(4)) | (BigInt(b.readUInt32LE(8)) << 32n);
  const condition = b.readUInt32LE(12);
  const collision = [7, 21, 23].some(
    (bit) => (flags & (1n << BigInt(bit))) !== 0n,
  );
  const beams = [b[23]!, b[24]!];
  const obstructed = beams.some((v) => v >= 7 && v <= 11);
  const clear = beams.every((v) => v >= 2 && v <= 6);
  return {
    state,
    batteryVoltage: b.readUInt16LE(0) / 100,
    obstruction: collision || obstructed ? true : clear ? false : null,
    inhibited:
      (condition & 1) !== 0 ||
      [19, 20, 21, 22, 23, 24, 25, 26, 30, 41, 49, 54].some(
        (bit) => (flags & (1n << BigInt(bit))) !== 0n,
      ),
  };
}

export type Target = "open" | "closed";
export function needsTrigger(target: Target, live: LiveState): boolean {
  if (
    live.state === target ||
    (target === "open" && live.state === "opening") ||
    (target === "closed" && live.state === "closing")
  )
    return false;
  if (
    live.inhibited ||
    live.obstruction === true ||
    (live.state !== "open" && live.state !== "closed")
  )
    throw new CentsysError("state-unavailable");
  return true;
}
