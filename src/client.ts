import { CentsysError } from "./errors.js";
import {
  credential,
  decodeDevices,
  decodeOverviews,
  normalizeNumber,
  record,
} from "./protocol.js";
import type { Device, Overview, Region } from "./protocol.js";

const origins = {
  za: "https://centsys.southafricanorth.cloudapp.azure.com:4445",
  au: "https://centsys.australiaeast.cloudapp.azure.com:4445",
};
type Operation =
  | "SendOtp"
  | "ValidateOtp"
  | "GetDevicesByRemoteUserNumber"
  | "GetOperatorOverview";

export interface ClientOptions {
  mobileNumber: string;
  region: Region;
  bootstrapToken?: string;
  sessionToken?: string;
  /** Dependency seam for deterministic HTTP tests; not exposed by the CLI. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class CentsysReadClient {
  readonly #mobileNumber: string;
  readonly #origin: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #bootstrapToken: string | undefined;
  #sessionToken: string | undefined;

  constructor(options: ClientOptions) {
    this.#mobileNumber = normalizeNumber(options.mobileNumber);
    if (options.region !== "za" && options.region !== "au")
      throw new CentsysError("configuration");
    this.#origin = origins[options.region];
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (
      !Number.isInteger(this.#timeoutMs) ||
      this.#timeoutMs < 1 ||
      this.#timeoutMs > 30_000
    ) {
      throw new CentsysError("configuration");
    }
    this.#bootstrapToken =
      options.bootstrapToken === undefined
        ? undefined
        : credential(options.bootstrapToken);
    this.#sessionToken =
      options.sessionToken === undefined
        ? undefined
        : credential(options.sessionToken);
  }

  async #request(
    operation: Operation,
    body: unknown,
    authenticated: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const bearer = authenticated
      ? this.#sessionToken
      : (this.#sessionToken ?? this.#bootstrapToken);
    if (!bearer) throw new CentsysError("authentication");
    const url = new URL(`/${operation}`, this.#origin);
    if (operation === "GetDevicesByRemoteUserNumber")
      url.searchParams.set("remoteUserNumber", this.#mobileNumber);
    const deadline = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      combined.throwIfAborted();
      const response = await this.#fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "homebridge-centsys/0.0.0",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: combined,
      });
      // Do not retain or print error responses; they may echo account data.
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new CentsysError("authentication");
        if (response.status === 429) throw new CentsysError("rate-limited");
        throw new CentsysError("http");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new CentsysError("protocol");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1_048_576) throw new CentsysError("protocol");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } catch {
        throw new CentsysError("protocol");
      }
    } catch (error) {
      if (signal?.aborted) throw new CentsysError("cancelled");
      if (deadline.aborted) throw new CentsysError("timeout");
      if (error instanceof CentsysError) throw error;
      throw new CentsysError("transport");
    }
  }

  async sendOtp(
    channel: "whatsapp" | "sms",
    signal?: AbortSignal,
  ): Promise<void> {
    if (channel !== "whatsapp" && channel !== "sms")
      throw new CentsysError("configuration");
    const result = await this.#request(
      "SendOtp",
      {
        MobileNumber: this.#mobileNumber,
        OtpPlatform: channel === "whatsapp" ? 1 : 2,
        ThreeLetterIsoLanguageName: "eng",
      },
      false,
      signal,
    );
    if (result !== true) throw new CentsysError("otp-not-sent");
  }

  async validateOtp(otp: string, signal?: AbortSignal): Promise<string> {
    if (!/^\d{4,10}$/.test(otp)) throw new CentsysError("configuration");
    const result = record(
      await this.#request(
        "ValidateOtp",
        { MobileNumber: this.#mobileNumber, Otp: otp },
        false,
        signal,
      ),
    );
    if (result.response === "") throw new CentsysError("otp-rejected");
    if (typeof result.response !== "string") throw new CentsysError("protocol");
    let token: string;
    try {
      token = credential(result.response);
    } catch {
      throw new CentsysError("protocol");
    }
    this.#sessionToken = token;
    return token;
  }

  async discover(signal?: AbortSignal): Promise<Device[]> {
    return decodeDevices(
      await this.#request(
        "GetDevicesByRemoteUserNumber",
        undefined,
        true,
        signal,
      ),
    );
  }

  async overview(
    devices: readonly Device[],
    signal?: AbortSignal,
  ): Promise<Overview[]> {
    if (devices.length === 0) return [];
    // Revalidate identities even when a library consumer constructs the list manually.
    const validated = decodeDevices(
      devices.map((device) => ({ serialNumber: device.serialNumber })),
    );
    const serials = validated.map((device) => device.serialNumber);
    return decodeOverviews(
      await this.#request(
        "GetOperatorOverview",
        { OperatorSerialNumbers: serials },
        true,
        signal,
      ),
      new Set(serials),
    );
  }
}
