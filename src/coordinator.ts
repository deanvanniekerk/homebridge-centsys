import { EventEmitter } from "node:events";
import { CentsysError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import type { GateState, Overview } from "./protocol.js";
import type { GateConfig } from "./settings.js";
import type { LiveState, Target } from "./mqtt-codec.js";

export interface Gateway {
  read(gates: readonly GateConfig[], signal: AbortSignal): Promise<Overview[]>;
  activate(
    gate: GateConfig,
    target: Target,
    signal: AbortSignal,
    onState: (state: LiveState) => void,
  ): Promise<{ live: LiveState; activated: boolean }>;
}
export interface Snapshot {
  state: GateState;
  receivedAt: number;
  obstruction: boolean | null;
  obstructionAt: number;
  target?: Target;
  error?: ErrorCode;
}
export class GateCoordinator extends EventEmitter {
  readonly #abort = new AbortController();
  readonly #snapshots = new Map<string, Snapshot>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #poll: Promise<void> | undefined;
  #command = false;
  #generation = 0;
  #cooldownUntil = 0;
  #fastUntil = 0;
  #failures = 0;
  #started = false;
  constructor(
    readonly gates: readonly GateConfig[],
    readonly gateway: Gateway,
    readonly pollInterval: number,
  ) {
    super();
  }
  snapshot(serial: string): Snapshot {
    const value = this.#snapshots.get(serial);
    if (
      !value ||
      Date.now() - value.receivedAt > Math.max(45_000, this.pollInterval * 2000)
    )
      return {
        state: "unknown",
        receivedAt: 0,
        obstruction: null,
        obstructionAt: 0,
        error: "state-unavailable",
      };
    return {
      ...value,
      obstruction:
        Date.now() - value.obstructionAt <= 10_000 ? value.obstruction : null,
    };
  }
  start() {
    if (this.#started || this.#abort.signal.aborted) return;
    this.#started = true;
    void this.#tick();
  }
  close() {
    this.#abort.abort();
    clearTimeout(this.#timer);
    this.removeAllListeners();
  }
  async #tick() {
    await this.refresh();
    if (this.#abort.signal.aborted) return;
    const delay = this.#failures
      ? Math.min(
          300_000,
          this.pollInterval * 1000 * 2 ** Math.min(this.#failures, 5),
        )
      : Date.now() < this.#fastUntil
        ? 2000
        : this.pollInterval * 1000;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#tick(), delay);
    this.#timer.unref();
  }
  refresh(): Promise<void> {
    if (this.#abort.signal.aborted) return Promise.resolve();
    if (this.#poll) return this.#poll;
    this.#poll = this.#refresh().finally(() => {
      this.#poll = undefined;
    });
    return this.#poll;
  }
  async #refresh() {
    // Do not allow an HTTP request begun before a command to overwrite its MQTT observations.
    if (this.#command) return;
    const generation = this.#generation;
    try {
      const rows = await this.gateway.read(this.gates, this.#abort.signal);
      if (this.#abort.signal.aborted || generation !== this.#generation) return;
      this.#failures = 0;
      for (const gate of this.gates) {
        const row = rows.find((r) => r.serialNumber === gate.serialNumber);
        const before = this.#snapshots.get(gate.serialNumber);
        const state = row?.state ?? "unknown";
        if (
          (state === "opening" || state === "closing") &&
          state !== before?.state
        )
          this.#fastUntil = Date.now() + 60_000;
        const target =
          before?.target &&
          Date.now() < this.#fastUntil &&
          state !== before.target
            ? before.target
            : undefined;
        this.#snapshots.set(gate.serialNumber, {
          state,
          receivedAt: Date.now(),
          obstruction: before?.obstruction ?? null,
          obstructionAt: before?.obstructionAt ?? 0,
          ...(target ? { target } : {}),
          ...(state === "unknown"
            ? { error: "state-unavailable" as const }
            : {}),
        });
      }
    } catch (error) {
      if (this.#abort.signal.aborted || generation !== this.#generation) return;
      this.#failures++;
      const code = error instanceof CentsysError ? error.code : "transport";
      for (const gate of this.gates)
        this.#snapshots.set(gate.serialNumber, {
          state: "unknown",
          receivedAt: Date.now(),
          obstruction: null,
          obstructionAt: 0,
          error: code,
        });
    }
    this.emit("update");
  }
  async setTarget(serial: string, target: Target): Promise<void> {
    if (target !== "open" && target !== "closed")
      throw new CentsysError("configuration");
    const gate = this.gates.find((g) => g.serialNumber === serial);
    if (!gate?.enableControl) throw new CentsysError("control-disabled");
    if (this.#abort.signal.aborted) throw new CentsysError("cancelled");
    if (this.#command || Date.now() < this.#cooldownUntil)
      throw new CentsysError("busy");
    this.#command = true;
    this.#generation++;
    const signal = AbortSignal.any([
      this.#abort.signal,
      AbortSignal.timeout(8000),
    ]);
    try {
      // Old HTTP reads are discarded by generation; they cannot delay a user command.
      await this.gateway.activate(gate, target, signal, (live) => {
        if (signal.aborted) return;
        this.#snapshots.set(serial, {
          state: live.state,
          receivedAt: Date.now(),
          obstruction: live.obstruction,
          obstructionAt: Date.now(),
        });
        this.emit("update");
      });
      if (this.#abort.signal.aborted) throw new CentsysError("cancelled");
      const state = this.#snapshots.get(serial);
      if (state) this.#snapshots.set(serial, { ...state, target });
      this.#fastUntil = Date.now() + 60_000;
    } catch (error) {
      this.#snapshots.set(serial, {
        state: "unknown",
        receivedAt: Date.now(),
        obstruction: null,
        obstructionAt: 0,
        error: error instanceof CentsysError ? error.code : "transport",
      });
      throw error;
    } finally {
      this.#command = false;
      this.#cooldownUntil = Date.now() + 5000;
      this.emit("update");
      // Resume promptly, including after ambiguous outcomes; observations never replay the command.
      if (this.#started && !this.#abort.signal.aborted) {
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.#tick(), 2000);
        this.#timer.unref();
      }
    }
  }
}
