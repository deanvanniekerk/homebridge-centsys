import mqtt from "mqtt";
import type { ConnectionOptions } from "node:tls";
import type { IClientOptions, MqttClient } from "mqtt";
import { readFile } from "node:fs/promises";
import { CentsysError } from "./errors.js";
import {
  identityPacket,
  timePacket,
  triggerPacket,
  challengeFrom,
  decodeActivationResponse,
  isResponse,
  decodeGateTelemetry,
  needsTrigger,
} from "./mqtt-codec.js";
import type { ActivationResponse, LiveState, Target } from "./mqtt-codec.js";
import type { Session } from "./storage.js";
import { gateIdentity } from "./settings.js";

type ConnectOptions = IClientOptions &
  Pick<ConnectionOptions, "pfx" | "passphrase">;
interface Options {
  /** Test seam only; not configurable through Homebridge. */
  connect?: (options: ConnectOptions) => MqttClient;
  timeoutMs?: number;
  session: Session;
  serialNumber: string;
  macAddress: string;
  certificate: { pfx: Buffer; password: string };
  target?: Target;
  signal?: AbortSignal;
  /** Recheck local session/configuration immediately before a physical command. */
  beforeActivation?: () => Promise<void>;
  onState?: (state: LiveState) => void;
  /** Numeric protocol diagnostics only; never raw packets or device/account identifiers. */
  onActivationResponse?: (
    response: ActivationResponse & { attempt: number },
  ) => void;
}
export interface MqttResult {
  live: LiveState;
  activated: boolean;
}

/** One bounded session. Only explicit configuration mismatch permits one corrected-version retry. */
export async function gateSession(options: Options): Promise<MqttResult> {
  if (
    options.target !== undefined &&
    options.target !== "open" &&
    options.target !== "closed"
  )
    throw new CentsysError("configuration");
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 5 ||
      options.timeoutMs > 30000)
  )
    throw new CentsysError("configuration");
  if (options.session.region !== "za")
    throw new CentsysError("control-disabled");
  const serial = gateIdentity(options.serialNumber);
  const identity = identityPacket(
    options.session.mobileNumber,
    options.macAddress,
  );
  const ca = await readFile(
    new URL("../resources/centsys-ca.crt", import.meta.url),
  );
  const clientId = `mcr:${options.session.mobileNumber}`;
  const topic = (suffix: string) => `${serial}/${suffix}`;
  const props = (suffix: string) => ({
    responseTopic: topic(suffix),
    userProperties: { ClientId: clientId },
  });
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let client: MqttClient | undefined;
    let done = false,
      awaitingOutcome = false,
      activated = false,
      ready = false;
    let attempts = 0;
    let configVersion = 0;
    let challenge: Buffer | undefined;
    let live: LiveState | undefined;
    let liveAt = 0;
    let stage:
      "connect" | "identity" | "telemetry" | "time" | "activating" | "ack" =
      "connect";
    const finish = (error?: CentsysError) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", aborted);
      if (client?.connected && ready) {
        // Release the operator's temporary telemetry session; bounded cleanup must not delay HAP.
        const closingClient = client;
        const cleanup = setTimeout(() => closingClient.end(true), 250);
        cleanup.unref();
        closingClient.publish(
          topic("disconnect"),
          Buffer.alloc(0),
          { qos: 0, retain: false, properties: props("disconnect") },
          () => {
            clearTimeout(cleanup);
            closingClient.end(true);
          },
        );
      } else client?.end(true);
      if (error)
        reject(
          awaitingOutcome && error.code !== "command-rejected"
            ? new CentsysError("command-uncertain")
            : error,
        );
      else if (live) resolve({ live, activated });
      else reject(new CentsysError("protocol"));
    };
    const aborted = () => finish(new CentsysError("cancelled"));
    const timer = setTimeout(
      () => finish(new CentsysError("timeout")),
      options.timeoutMs ?? 25_000,
    );
    options.signal?.addEventListener("abort", aborted, { once: true });
    const publish = (
      suffix: string,
      payload: Buffer,
      response: string,
      qos: 0 | 2 = 0,
    ) => {
      if (done) return;
      client!.publish(
        topic(suffix),
        payload,
        { qos, retain: false, properties: props(response) },
        (error) => {
          if (error) finish(new CentsysError("transport"));
        },
      );
    };
    const proceed = () => {
      if (done || !ready || !challenge || !live || stage !== "telemetry")
        return;
      try {
        if (
          options.target === undefined ||
          !needsTrigger(options.target, live)
        ) {
          finish();
          return;
        }
        stage = "time";
        publish(
          "userRemoteTrigger",
          timePacket(options.macAddress),
          "userRemoteTriggerResponse",
        );
      } catch (error) {
        finish(
          error instanceof CentsysError ? error : new CentsysError("protocol"),
        );
      }
    };
    const activate = async () => {
      if (
        done ||
        stage !== "time" ||
        !challenge ||
        !live ||
        options.target === undefined
      )
        return;
      stage = "activating";
      try {
        await options.beforeActivation?.();
        if (done) return;
        if (Date.now() - liveAt > 5000)
          throw new CentsysError("state-unavailable");
        if (!needsTrigger(options.target, live)) {
          finish();
          return;
        }
        const packet = triggerPacket(
          options.macAddress,
          challenge,
          configVersion,
        );
        stage = "ack";
        attempts++;
        awaitingOutcome = true;
        publish("userRemoteTrigger", packet, "userRemoteTriggerResponse");
      } catch (error) {
        finish(
          error instanceof CentsysError ? error : new CentsysError("protocol"),
        );
      }
    };
    try {
      const connectionOptions: ConnectOptions = {
        protocol: "mqtts",
        host: "20.87.192.195",
        port: 8880,
        servername: "CentsysQA",
        ca,
        pfx: options.certificate.pfx,
        passphrase: options.certificate.password,
        rejectUnauthorized: true,
        protocolVersion: 5,
        clientId,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: 10_000,
        keepalive: 15,
      };
      client = (options.connect ?? mqtt.connect)(connectionOptions);
      client.on("error", () => finish(new CentsysError("transport")));
      client.on("close", () => {
        if (!done) finish(new CentsysError("transport"));
      });
      client.on("disconnect", () => finish(new CentsysError("transport")));
      client.on("connect", () =>
        client!.subscribe(
          [
            topic("connectionRequestResponse"),
            topic("userRemoteTriggerResponse"),
            topic("deviceOverview"),
          ],
          { qos: 0 },
          (error, granted) => {
            if (error || !granted || granted.some((g) => g.qos > 2)) {
              finish(new CentsysError("protocol"));
              return;
            }
            publish(
              "connectionRequest",
              Buffer.alloc(0),
              "connectionRequestResponse",
              2,
            );
          },
        ),
      );
      client.on("message", (name, payload, packet) => {
        if (done || packet.retain) return;
        try {
          if (
            name === topic("connectionRequestResponse") &&
            stage === "connect"
          ) {
            if (payload.length !== 1) throw new CentsysError("protocol");
            stage = "identity";
            publish("userRemoteTrigger", identity, "userRemoteTriggerResponse");
          } else if (name === topic("userRemoteTriggerResponse")) {
            if (stage === "identity") {
              challenge = challengeFrom(payload);
              ready = true;
              stage = "telemetry";
              proceed();
            } else if (stage === "time" && isResponse(payload, 6))
              void activate();
            else if (stage === "ack") {
              const response = decodeActivationResponse(
                payload,
                options.macAddress,
              );
              awaitingOutcome = false;
              activated = response.code === 1;
              options.onActivationResponse?.({
                ...response,
                attempt: attempts,
              });
              if (
                response.code === 7 &&
                attempts === 1 &&
                response.configVersion !== configVersion
              ) {
                // The controller explicitly rejected this version. Match the pinned
                // reference's single negotiation, with all pre-command checks repeated.
                configVersion = response.configVersion;
                stage = "time";
                void activate();
              } else
                finish(
                  activated ? undefined : new CentsysError("command-rejected"),
                );
            }
          } else if (name === topic("deviceOverview") && ready) {
            live = decodeGateTelemetry(payload);
            liveAt = Date.now();
            options.onState?.(live);
            proceed();
          }
        } catch (error) {
          finish(
            error instanceof CentsysError
              ? error
              : new CentsysError("protocol"),
          );
        }
      });
    } catch {
      finish(new CentsysError("transport"));
    }
  });
}
