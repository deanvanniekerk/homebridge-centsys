import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";
import {
  PLUGIN_NAME,
  PLATFORM_NAME,
  VERSION,
  parseConfig,
  storageDirectory,
} from "./settings.js";
import type { CentsysConfig } from "./settings.js";
import { CloudGateway } from "./gateway.js";
import { GateCoordinator } from "./coordinator.js";
import type { Gateway } from "./coordinator.js";
import { CentsysError } from "./errors.js";

export class CentsysPlatform implements DynamicPlatformPlugin {
  readonly #cached = new Map<string, PlatformAccessory>();
  readonly #config: CentsysConfig | undefined;
  readonly #coordinator: GateCoordinator | undefined;
  #lastError: string | undefined;
  constructor(
    readonly log: Logger,
    readonly config: PlatformConfig,
    readonly api: API,
    dependencies: { gateway?: Gateway } = {},
  ) {
    try {
      this.#config = parseConfig(config);
      this.#coordinator = new GateCoordinator(
        this.#config.gates,
        dependencies.gateway ??
          new CloudGateway(storageDirectory(api.user.storagePath())),
        this.#config.pollInterval,
      );
    } catch {
      log.error(
        "CENTSYS configuration is invalid. Open the plugin settings to correct it.",
      );
    }
    api.on("shutdown", () => this.#coordinator?.close());
    api.on("didFinishLaunching", () => this.#launch());
  }
  configureAccessory(accessory: PlatformAccessory) {
    this.#cached.set(accessory.UUID, accessory);
    // Homebridge otherwise restores a stale successful value from its accessory cache.
    const C = this.api.hap.Characteristic;
    const {
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE },
    } = this.api.hap;
    const service = accessory.getService(this.api.hap.Service.GarageDoorOpener);
    const unavailable = () => {
      throw new this.api.hap.HapStatusError(SERVICE_COMMUNICATION_FAILURE);
    };
    service?.getCharacteristic(C.CurrentDoorState).onGet(unavailable);
    service
      ?.getCharacteristic(C.TargetDoorState)
      .onGet(unavailable)
      .onSet(unavailable);
    service?.getCharacteristic(C.ObstructionDetected).onGet(unavailable);
  }
  #launch() {
    if (!this.#config || !this.#coordinator) return;
    const {
      Service: S,
      Characteristic: C,
      HapStatusError,
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE, INVALID_VALUE_IN_REQUEST },
    } = this.api.hap;
    const selected = new Set<string>();
    const updates: (() => void)[] = [];
    for (const gate of this.#config.gates) {
      const uuid = this.api.hap.uuid.generate(
        `centsys:gate:${gate.serialNumber}`,
      );
      selected.add(uuid);
      let accessory = this.#cached.get(uuid);
      const fresh = !accessory;
      accessory ??= new this.api.platformAccessory(gate.name, uuid);
      accessory.displayName = gate.name;
      accessory.context = {};
      accessory
        .getService(S.AccessoryInformation)
        ?.setCharacteristic(C.Manufacturer, "CENTURION / CENTSYS")
        .setCharacteristic(C.Model, "SMART+ gate")
        .setCharacteristic(C.SerialNumber, uuid)
        .setCharacteristic(C.FirmwareRevision, VERSION);
      const service =
        accessory.getService(S.GarageDoorOpener) ??
        accessory.addService(S.GarageDoorOpener, gate.name);
      service.setCharacteristic(C.Name, gate.name);
      const unavailable = () =>
        new HapStatusError(SERVICE_COMMUNICATION_FAILURE);
      const current = () => {
        const state = this.#coordinator!.snapshot(gate.serialNumber);
        if (state.error || state.state === "unknown") throw unavailable();
        return {
          open: 0,
          closed: 1,
          opening: 2,
          closing: 3,
          "partly-open": 4,
          "partly-closed": 4,
        }[state.state];
      };
      const target = () => {
        const state = this.#coordinator!.snapshot(gate.serialNumber);
        if (state.error || state.state === "unknown") throw unavailable();
        const value =
          state.target ??
          (state.state === "open" || state.state === "opening"
            ? "open"
            : state.state === "closed" || state.state === "closing"
              ? "closed"
              : undefined);
        if (value === undefined) throw unavailable();
        return value === "open" ? 0 : 1;
      };
      const obstruction = () => {
        const state = this.#coordinator!.snapshot(gate.serialNumber);
        if (state.error || state.state === "unknown") throw unavailable();
        // HomeKit has no unknown Boolean. Report detected obstructions only;
        // absence of a report is not clearance for an activation. Keep the
        // coordinator's nullable telemetry unchanged for command checks.
        return state.obstruction === true;
      };
      service.getCharacteristic(C.CurrentDoorState).onGet(current);
      service
        .getCharacteristic(C.TargetDoorState)
        .onGet(target)
        .onSet(async (value) => {
          if (value !== 0 && value !== 1)
            throw new HapStatusError(INVALID_VALUE_IN_REQUEST);
          try {
            await this.#coordinator!.setTarget(
              gate.serialNumber,
              value === 0 ? "open" : "closed",
            );
          } catch (error) {
            this.log.warn(
              error instanceof CentsysError
                ? error.message
                : "Gate request failed. Check the gate before trying again.",
            );
            throw unavailable();
          }
        });
      service.getCharacteristic(C.ObstructionDetected).onGet(obstruction);
      updates.push(() => {
        for (const [type, get] of [
          [C.CurrentDoorState, current],
          [C.TargetDoorState, target],
          [C.ObstructionDetected, obstruction],
        ] as const) {
          try {
            service.updateCharacteristic(type, get());
          } catch {
            service.updateCharacteristic(type, unavailable());
          }
        }
      });
      this.#cached.set(uuid, accessory);
      if (fresh)
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ]);
      else this.api.updatePlatformAccessories([accessory]);
    }
    for (const [uuid, accessory] of this.#cached)
      if (!selected.has(uuid)) {
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ]);
        this.#cached.delete(uuid);
      }
    this.#coordinator.on("update", () => {
      updates.forEach((update) => update());
      const error = this.#config!.gates.map(
        (g) => this.#coordinator!.snapshot(g.serialNumber).error,
      ).find(Boolean);
      if (error && error !== this.#lastError)
        this.log.warn(new CentsysError(error).message);
      this.#lastError = error;
    });
    updates.forEach((update) => update());
    this.#coordinator.start();
    this.log.info(
      "CENTSYS monitoring started. Configure sign-in and gates in the plugin settings.",
    );
  }
}
