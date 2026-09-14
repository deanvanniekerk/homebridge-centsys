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
  | "GetOperatorOverview"
  | "GetCertificate";

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

  async #request<T = unknown>(
    operation: Operation,
    body: unknown,
    authenticated: boolean,
    signal?: AbortSignal,
    decode: (value: unknown) => T = (value) => value as T,
  ): Promise<T> {
    const bearer = authenticated
      ? this.#sessionToken
      : (this.#sessionToken ?? this.#bootstrapToken);
    if (!bearer) throw new CentsysError("authentication", { operation });
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
          throw new CentsysError("authentication", { status: response.status });
        if (response.status === 429)
          throw new CentsysError("rate-limited", { status: response.status });
        throw new CentsysError("http", { status: response.status });
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw new CentsysError("protocol", { reason: "missing-body" });
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1_048_576)
            throw new CentsysError("protocol", {
              reason: "body-too-large",
              bytes,
            });
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new CentsysError("protocol", { reason: "invalid-json", bytes });
      }
      return decode(value);
    } catch (error) {
      if (signal?.aborted) throw new CentsysError("cancelled", { operation });
      if (deadline.aborted) throw new CentsysError("timeout", { operation });
      if (error instanceof CentsysError) throw error.withContext({ operation });
      throw new CentsysError("transport", { operation });
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

  async certificate(
    signal?: AbortSignal,
  ): Promise<{ pfx: Buffer; password: string }> {
    return this.#request("GetCertificate", {}, true, signal, (value) => {
      const data = record(value);
      const fields = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const pfx = fields.certificatepfxbase64 ?? fields.pfxbase64;
      const password = fields.certificatepassword ?? fields.password ?? "";
      if (
        typeof pfx !== "string" ||
        pfx.length < 4 ||
        pfx.length > 131072 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(pfx) ||
        pfx.length % 4 !== 0 ||
        typeof password !== "string" ||
        password.length > 4096
      )
        throw new CentsysError("protocol", { reason: "invalid-certificate" });
      return { pfx: Buffer.from(pfx, "base64"), password };
    });
  }

  async discover(signal?: AbortSignal): Promise<Device[]> {
    return this.#request(
      "GetDevicesByRemoteUserNumber",
      undefined,
      true,
      signal,
      decodeDevices,
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
    return this.#request(
      "GetOperatorOverview",
      { OperatorSerialNumbers: serials },
      true,
      signal,
      (value) => decodeOverviews(value, new Set(serials)),
    );
  }
}
