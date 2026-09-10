import { EventEmitter } from "node:events";
import { CentsysError } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import type { GateState, Overview } from "./protocol.js";
import { LIVE_REFRESH_MS, LIVE_EXPIRY_MS } from "./protocol.js";
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
  liveVerifiedAt?: number;
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
  #expiryTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (!value || Date.now() > this.#expiresAt(value))
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
    clearTimeout(this.#expiryTimer);
    this.removeAllListeners();
  }
  #expiresAt(value: Snapshot) {
    return Math.min(
      value.receivedAt + Math.max(45_000, this.pollInterval * 2000),
      value.liveVerifiedAt === undefined
        ? Infinity
        : value.liveVerifiedAt + LIVE_EXPIRY_MS,
    );
  }
  #updated() {
    clearTimeout(this.#expiryTimer);
    if (this.#abort.signal.aborted) return;
    this.emit("update");
    const next = Math.min(
      ...[...this.#snapshots.values()]
        .filter((value) => !value.error && value.state !== "unknown")
        .map((value) => this.#expiresAt(value) + 1)
        .filter((at) => at > Date.now()),
    );
    if (Number.isFinite(next)) {
      this.#expiryTimer = setTimeout(() => this.#updated(), next - Date.now());
      this.#expiryTimer.unref();
    }
  }
  async #tick() {
    await this.refresh();
    if (this.#abort.signal.aborted) return;
    let delay = this.#failures
      ? Math.min(
          300_000,
          this.pollInterval * 1000 * 2 ** Math.min(this.#failures, 5),
        )
      : Date.now() < this.#fastUntil
        ? 2000
        : this.pollInterval * 1000;
    if (!this.#failures) {
      const due = Math.min(
        ...[...this.#snapshots.values()]
          .filter((value) => !value.error && value.liveVerifiedAt !== undefined)
          .map((value) => value.liveVerifiedAt! + LIVE_REFRESH_MS),
      );
      delay = Math.min(delay, Math.max(1, due - Date.now()));
    }
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
          ...(row?.liveVerifiedAt === undefined
            ? {}
            : { liveVerifiedAt: row.liveVerifiedAt }),
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
    this.#updated();
  }
  #commandGate(serial: string, target: Target): GateConfig {
    if (target !== "open" && target !== "closed")
      throw new CentsysError("configuration");
    const gate = this.gates.find((g) => g.serialNumber === serial);
    if (!gate?.enableControl) throw new CentsysError("control-disabled");
    if (this.#abort.signal.aborted) throw new CentsysError("cancelled");
    if (this.#command || Date.now() < this.#cooldownUntil)
      throw new CentsysError("busy");
    return gate;
  }
  /** Accept one bounded job without holding HomeKit's write response open. */
  requestTarget(
    serial: string,
    target: Target,
    onError: (error: unknown) => void,
  ): void {
    this.#commandGate(serial, target);
    void this.setTarget(serial, target).catch(onError);
  }
  async setTarget(serial: string, target: Target): Promise<void> {
    const gate = this.#commandGate(serial, target);
    this.#command = true;
    this.#generation++;
    const before = this.#snapshots.get(serial);
    if (before) this.#snapshots.set(serial, { ...before, target });
    this.#updated();
    const deadline = AbortSignal.timeout(30_000);
    const signal = AbortSignal.any([this.#abort.signal, deadline]);
    try {
      // Old HTTP reads are discarded by generation; they cannot delay a user command.
      await this.gateway.activate(gate, target, signal, (live) => {
        if (signal.aborted) return;
        this.#snapshots.set(serial, {
          state: live.state,
          receivedAt: Date.now(),
          liveVerifiedAt: Date.now(),
          obstruction: live.obstruction,
          obstructionAt: Date.now(),
          target,
        });
        this.#updated();
      });
      if (this.#abort.signal.aborted) throw new CentsysError("cancelled");
      const state = this.#snapshots.get(serial);
      if (state) this.#snapshots.set(serial, { ...state, target });
      this.#fastUntil = Date.now() + 60_000;
    } catch (error) {
      if (
        deadline.aborted &&
        !(error instanceof CentsysError && error.code === "command-uncertain")
      )
        error = new CentsysError("timeout");
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
      this.#updated();
      // Resume promptly, including after ambiguous outcomes; observations never replay the command.
      if (this.#started && !this.#abort.signal.aborted) {
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.#tick(), 2000);
        this.#timer.unref();
      }
    }
  }
}
