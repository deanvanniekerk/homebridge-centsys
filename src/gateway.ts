import { CentsysReadClient } from "./client.js";
import { readSession } from "./storage.js";
import type { Session } from "./storage.js";
import { decodeDevices, LIVE_REFRESH_MS } from "./protocol.js";
import type { Overview } from "./protocol.js";
import { gateSession } from "./mqtt-session.js";
import type { GateConfig } from "./settings.js";
import type { ActivationResponse, LiveState, Target } from "./mqtt-codec.js";
import { withSessionLock } from "./session-lock.js";
import { CentsysError } from "./errors.js";

export class CloudGateway {
  #session: Session | undefined;
  #client: CentsysReadClient | undefined;
  #certificate: { pfx: Buffer; password: string } | undefined;
  #certificateAt = 0;
  readonly #verified = new Map<string, { at: number; live: LiveState }>();
  #reading:
    { abort: AbortController; promise: Promise<Overview[]> } | undefined;
  #command = false;
  readonly #runSession: typeof gateSession;
  constructor(
    readonly directory: string,
    readonly onActivationResponse?: (
      response: ActivationResponse & { attempt: number },
    ) => void,
    dependencies: { runSession?: typeof gateSession } = {},
  ) {
    this.#runSession = dependencies.runSession ?? gateSession;
  }
  async #load() {
    const session = await readSession(this.directory);
    if (
      !this.#client ||
      this.#session?.token !== session.token ||
      this.#session?.mobileNumber !== session.mobileNumber ||
      this.#session?.region !== session.region
    ) {
      this.#session = session;
      this.#client = new CentsysReadClient({
        mobileNumber: session.mobileNumber,
        region: session.region,
        sessionToken: session.token,
      });
      this.#certificate = undefined;
      this.#verified.clear();
    }
    return { session, client: this.#client };
  }
  async #lockedSession(options: Parameters<typeof gateSession>[0]) {
    return withSessionLock(
      this.directory,
      options.signal ?? new AbortController().signal,
      (signal) => this.#runSession({ ...options, signal }),
    );
  }
  async #getCertificate(client: CentsysReadClient, signal: AbortSignal) {
    if (!this.#certificate || Date.now() - this.#certificateAt > 3_600_000) {
      this.#certificate = await client.certificate(signal);
      this.#certificateAt = Date.now();
    }
    signal.throwIfAborted();
    return this.#certificate;
  }
  #key(gate: GateConfig) {
    return `${gate.serialNumber}/${gate.macAddress}`;
  }
  read(gates: readonly GateConfig[], signal: AbortSignal): Promise<Overview[]> {
    if (this.#command || this.#reading)
      return Promise.reject(new CentsysError("busy"));
    const abort = new AbortController();
    const promise = this.#read(gates, AbortSignal.any([signal, abort.signal]));
    const reading = { abort, promise };
    this.#reading = reading;
    void promise
      .finally(() => {
        if (this.#reading === reading) this.#reading = undefined;
      })
      .catch(() => {});
    return promise;
  }
  async #read(
    gates: readonly GateConfig[],
    signal: AbortSignal,
  ): Promise<Overview[]> {
    const { session, client } = await this.#load();
    const refreshed = new Set<string>();
    for (const gate of gates) {
      signal.throwIfAborted();
      if (!gate.macAddress || session.region !== "za")
        throw new CentsysError("state-unavailable");
      const key = this.#key(gate);
      const previous = this.#verified.get(key);
      if (previous && Date.now() - previous.at < LIVE_REFRESH_MS) continue;
      // Remove old proof before probing: neither failure nor cancellation renews it.
      this.#verified.delete(key);
      const result = await this.#lockedSession({
        session,
        serialNumber: gate.serialNumber,
        macAddress: gate.macAddress,
        certificate: await this.#getCertificate(client, signal),
        signal,
      });
      signal.throwIfAborted();
      this.#verified.set(key, { at: Date.now(), live: result.live });
      refreshed.add(key);
    }
    const rows = await client.overview(
      decodeDevices(gates.map((g) => ({ serialNumber: g.serialNumber }))),
      signal,
    );
    signal.throwIfAborted();
    return gates.map((gate) => {
      const key = this.#key(gate);
      const proof = this.#verified.get(key)!;
      const row = rows.find((r) => r.serialNumber === gate.serialNumber);
      return {
        serialNumber: gate.serialNumber,
        state: refreshed.has(key)
          ? proof.live.state
          : (row?.state ?? "unknown"),
        stateCode: refreshed.has(key) ? null : (row?.stateCode ?? null),
        powerSupplyCode: row?.powerSupplyCode ?? null,
        closingBeamCode: row?.closingBeamCode ?? null,
        openingBeamCode: row?.openingBeamCode ?? null,
        theftAlarmCode: row?.theftAlarmCode ?? null,
        liveVerifiedAt: proof.at,
      };
    });
  }
  async activate(
    gate: GateConfig,
    target: Target,
    signal: AbortSignal,
    onState: (state: LiveState) => void,
  ) {
    if (!gate.enableControl || !gate.macAddress)
      throw new CentsysError("control-disabled");
    if (this.#command) throw new CentsysError("busy");
    this.#command = true;
    try {
      // The broker uses one account client ID. Finish monitoring teardown before control connects.
      const reading = this.#reading;
      reading?.abort.abort();
      await reading?.promise.catch(() => {});
      signal.throwIfAborted();
      const { session, client } = await this.#load();
      return await this.#lockedSession({
        session,
        serialNumber: gate.serialNumber,
        macAddress: gate.macAddress,
        certificate: await this.#getCertificate(client, signal),
        target,
        signal,
        onState: (live) => {
          if (signal.aborted) return;
          this.#verified.set(this.#key(gate), { at: Date.now(), live });
          onState(live);
        },
        onActivationResponse: (reply) => this.onActivationResponse?.(reply),
        beforeActivation: async () => {
          const current = await readSession(this.directory);
          if (
            current.token !== session.token ||
            current.mobileNumber !== session.mobileNumber ||
            current.region !== session.region
          )
            throw new CentsysError("authentication");
          signal.throwIfAborted();
        },
      });
    } catch (error) {
      this.#verified.delete(this.#key(gate));
      throw error;
    } finally {
      this.#command = false;
    }
  }
}
