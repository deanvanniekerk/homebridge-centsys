import { randomUUID } from "node:crypto";
import { CentsysReadClient } from "./client.js";
import { CentsysError } from "./errors.js";
import {
  credential,
  normalizeNumber,
  record,
  decodeDevices,
} from "./protocol.js";
import type { Region } from "./protocol.js";
import type { Session } from "./storage.js";
import {
  hasPrivate,
  readPrivate,
  writePrivate,
  readSession,
  saveSession,
  forgetSession,
} from "./storage.js";
import { fetchBootstrap } from "./bootstrap.js";
import { wifiMacCandidate } from "./mac-setup.js";
import { withSessionLock } from "./session-lock.js";
import { gateSession } from "./mqtt-session.js";
import { gateIdentity } from "./settings.js";

type Client = Pick<
  CentsysReadClient,
  "sendOtp" | "validateOtp" | "discover" | "overview" | "certificate"
>;
interface SetupOptions {
  directory: string;
  createClient?: (
    options: ConstructorParameters<typeof CentsysReadClient>[0],
  ) => Client;
  bootstrap?: () => Promise<string>;
  now?: () => number;
  verifySession?: typeof gateSession;
}

/** UI lifetime owns OTP challenges; only a validated session reaches persistent storage. */
export class SetupService {
  readonly #directory: string;
  readonly #client: NonNullable<SetupOptions["createClient"]>;
  readonly #bootstrap: () => Promise<string>;
  readonly #now: () => number;
  readonly #verifySession: typeof gateSession;
  #busy = false;
  #pending:
    | {
        id: string;
        mobileNumber: string;
        region: Region;
        client: Client;
        expires: number;
        attempts: number;
      }
    | undefined;

  constructor(options: SetupOptions) {
    this.#directory = options.directory;
    this.#client = options.createClient ?? ((o) => new CentsysReadClient(o));
    this.#bootstrap = options.bootstrap ?? fetchBootstrap;
    this.#now = options.now ?? Date.now;
    this.#verifySession = options.verifySession ?? gateSession;
  }
  async #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#busy) throw new CentsysError("rate-limited");
    this.#busy = true;
    try {
      return await fn();
    } finally {
      this.#busy = false;
    }
  }
  #authenticated(session: Session): Client {
    return this.#client({
      mobileNumber: session.mobileNumber,
      region: session.region,
      sessionToken: session.token,
    });
  }
  async status() {
    if (!(await hasPrivate("session.json", this.#directory)))
      return { state: "signed-out" };
    const session = await readSession(this.#directory);
    try {
      // Empty discovery is valid and still proves the saved bearer is accepted.
      await this.#authenticated(session).discover();
      return {
        state: "signed-in",
        region: session.region,
        accountSuffix: session.mobileNumber.slice(-4),
      };
    } catch (error) {
      if (error instanceof CentsysError && error.code === "authentication")
        return { state: "sign-in-required" };
      throw error;
    }
  }
  async sendCode(input: unknown) {
    return this.#exclusive(async () => {
      const row = record(input);
      if (
        typeof row.mobileNumber !== "string" ||
        (row.region !== "za" && row.region !== "au") ||
        (row.channel !== "sms" && row.channel !== "whatsapp")
      )
        throw new CentsysError("configuration");
      const mobileNumber = normalizeNumber(row.mobileNumber);
      if (await hasPrivate("otp-attempt.json", this.#directory)) {
        const previous = record(
          JSON.parse(await readPrivate("otp-attempt.json", this.#directory)),
        );
        if (
          typeof previous.sentAt !== "number" ||
          !Number.isFinite(previous.sentAt)
        )
          throw new CentsysError("local-storage");
        if (this.#now() - previous.sentAt < 60_000)
          throw new CentsysError("rate-limited");
      }
      // Persist the cooldown before the request: a modal reopen cannot immediately resend.
      await writePrivate(
        "otp-attempt.json",
        JSON.stringify({ sentAt: this.#now() }),
        this.#directory,
      );
      this.#pending = undefined;
      let bootstrap: string;
      if (await hasPrivate("bootstrap-token", this.#directory))
        bootstrap = credential(
          (await readPrivate("bootstrap-token", this.#directory)).trim(),
        );
      else {
        bootstrap = credential(await this.#bootstrap());
        await writePrivate("bootstrap-token", bootstrap, this.#directory);
      }
      const region = row.region;
      const client = this.#client({
        mobileNumber,
        region,
        bootstrapToken: bootstrap,
      });
      await client.sendOtp(row.channel);
      const id = randomUUID();
      this.#pending = {
        id,
        client,
        mobileNumber,
        region,
        expires: this.#now() + 600_000,
        attempts: 0,
      };
      return { challengeId: id };
    });
  }
  async verifyCode(input: unknown) {
    return this.#exclusive(async () => {
      const row = record(input);
      const pending = this.#pending;
      if (
        !pending ||
        row.challengeId !== pending.id ||
        pending.expires <= this.#now() ||
        pending.attempts >= 5
      )
        throw new CentsysError("otp-rejected");
      if (typeof row.code !== "string" || !/^\d{4,10}$/.test(row.code))
        throw new CentsysError("configuration");
      pending.attempts++;
      const token = await pending.client.validateOtp(row.code);
      await saveSession(
        { mobileNumber: pending.mobileNumber, region: pending.region, token },
        this.#directory,
      );
      this.#pending = undefined;
      return { state: "signed-in" };
    });
  }
  async devices() {
    const session = await readSession(this.#directory);
    const devices = await this.#authenticated(session).discover();
    return devices.map((d) => ({
      serialNumber: d.serialNumber,
      label: `Gate …${d.serialNumber.slice(-6)}`,
      ...(d.macAddress ? { macAddress: d.macAddress } : {}),
    }));
  }
  async checkGate(input: unknown) {
    const serialNumber = gateIdentity(record(input).serialNumber);
    const session = await readSession(this.#directory);
    const rows = await this.#authenticated(session).overview(
      decodeDevices([{ serialNumber }]),
    );
    if (!rows[0]) return { found: false, state: "unknown" };
    return { found: true, state: rows[0].state };
  }
  async verifyWifiAddress(input: unknown) {
    return this.#exclusive(async () => {
      const candidate = wifiMacCandidate(input);
      const session = await readSession(this.#directory);
      if (session.region !== "za") throw new CentsysError("control-disabled");
      const deadline = AbortSignal.timeout(30_000);
      try {
        return await withSessionLock(
          this.#directory,
          deadline,
          async (signal) => {
            const certificate =
              await this.#authenticated(session).certificate(signal);
            const result = await this.#verifySession({
              session,
              ...candidate,
              certificate,
              signal,
              // No target, time sync or activation. Success requires identity AND live telemetry.
            });
            const current = await readSession(this.#directory);
            if (
              current.token !== session.token ||
              current.mobileNumber !== session.mobileNumber ||
              current.region !== session.region
            )
              throw new CentsysError("authentication");
            if (result.activated || result.live.state === "unknown")
              throw new CentsysError("state-unavailable");
            signal.throwIfAborted();
            return { ...candidate, state: result.live.state, verified: true };
          },
        );
      } catch (error) {
        if (deadline.aborted) throw new CentsysError("timeout");
        throw error;
      }
    });
  }
  async logout() {
    return this.#exclusive(async () => {
      this.#pending = undefined;
      await forgetSession(this.#directory);
      return { state: "signed-out" };
    });
  }
}
