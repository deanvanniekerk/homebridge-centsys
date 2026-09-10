import { CentsysReadClient } from "./client.js";
import { readSession } from "./storage.js";
import type { Session } from "./storage.js";
import { decodeDevices } from "./protocol.js";
import { gateSession } from "./mqtt-session.js";
import type { GateConfig } from "./settings.js";
import type { ActivationResponse, LiveState, Target } from "./mqtt-codec.js";
import { CentsysError } from "./errors.js";

export class CloudGateway {
  #session: Session | undefined;
  #client: CentsysReadClient | undefined;
  #certificate: { pfx: Buffer; password: string } | undefined;
  #certificateAt = 0;
  constructor(
    readonly directory: string,
    readonly onActivationResponse?: (
      response: ActivationResponse & { attempt: number },
    ) => void,
  ) {}
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
    }
    return { session, client: this.#client };
  }
  async read(gates: readonly GateConfig[], signal: AbortSignal) {
    const { client } = await this.#load();
    return client.overview(
      decodeDevices(gates.map((g) => ({ serialNumber: g.serialNumber }))),
      signal,
    );
  }
  async activate(
    gate: GateConfig,
    target: Target,
    signal: AbortSignal,
    onState: (state: LiveState) => void,
  ) {
    if (!gate.enableControl || !gate.macAddress)
      throw new CentsysError("control-disabled");
    const { session, client } = await this.#load();
    if (!this.#certificate || Date.now() - this.#certificateAt > 3_600_000) {
      this.#certificate = await client.certificate(signal);
      this.#certificateAt = Date.now();
    }
    return gateSession({
      session,
      serialNumber: gate.serialNumber,
      macAddress: gate.macAddress,
      certificate: this.#certificate,
      target,
      signal,
      onState,
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
  }
}
