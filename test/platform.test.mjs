import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import hap from "@homebridge/hap-nodejs";
import { PlatformAccessory } from "../node_modules/homebridge/dist/platformAccessory.js";
import { CentsysPlatform } from "../dist/platform.js";
import { parseConfig } from "../dist/settings.js";
const serialNumber = "00112233445566778899AABB";
const config = { platform: "Centsys", gates: [{ name: "Gate", serialNumber }] };
test("real HAP garage service remains readable with cloud state and no obstruction report, and rejects disabled writes", async (t) => {
  let commands = 0;
  const api = Object.assign(new EventEmitter(), {
    hap,
    platformAccessory: PlatformAccessory,
    user: { storagePath: () => "/unused" },
    registerPlatformAccessories: (_p, _n, accessories) => {
      api.registered = accessories;
    },
    updatePlatformAccessories: () => {},
    unregisterPlatformAccessories: () => {},
  });
  const gateway = {
    read: async () => [{ serialNumber, state: "closed" }],
    activate: async () => {
      commands++;
    },
  };
  const log = {
    info: () => {},
    warn: () => {},
    error: (message) => assert.fail(message),
  };
  const platform = new CentsysPlatform(log, config, api, { gateway });
  t.after(() => api.emit("shutdown"));
  const accessory = new PlatformAccessory(
    "Gate",
    hap.uuid.generate(`centsys:gate:${serialNumber}`),
  );
  const service = accessory.addService(hap.Service.GarageDoorOpener, "Gate");
  service.updateCharacteristic(hap.Characteristic.CurrentDoorState, 1);
  platform.configureAccessory(accessory);
  await assert.rejects(
    service
      .getCharacteristic(hap.Characteristic.CurrentDoorState)
      .handleGetRequest(),
  );
  api.emit("didFinishLaunching");
  await new Promise((r) => setImmediate(r));
  assert.equal(
    await service
      .getCharacteristic(hap.Characteristic.CurrentDoorState)
      .handleGetRequest(),
    1,
  );
  assert.equal(
    await service
      .getCharacteristic(hap.Characteristic.TargetDoorState)
      .handleGetRequest(),
    1,
  );
  assert.equal(
    service.getCharacteristic(hap.Characteristic.ObstructionDetected)
      .statusCode,
    hap.HAPStatus.SUCCESS,
    "a missing obstruction report must not mark a reachable gate as No Response",
  );
  assert.equal(
    await service
      .getCharacteristic(hap.Characteristic.ObstructionDetected)
      .handleGetRequest(),
    false,
  );
  await assert.rejects(
    service
      .getCharacteristic(hap.Characteristic.TargetDoorState)
      .handleSetRequest(0),
  );
  assert.equal(commands, 0);
  assert.equal(api.registered, undefined);
  assert.deepEqual(accessory.context, {});
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 60_000 });
  for (const type of [
    hap.Characteristic.CurrentDoorState,
    hap.Characteristic.TargetDoorState,
    hap.Characteristic.ObstructionDetected,
  ]) {
    await assert.rejects(service.getCharacteristic(type).handleGetRequest());
  }
});
test("configuration requires explicit supported control profile, MAC and trigger-mode confirmation", () => {
  assert.equal(parseConfig(config).gates[0].enableControl, false);
  for (const extra of [
    { enableControl: true },
    { enableControl: true, macAddress: "AA:BB:CC:DD:EE:FF" },
    {
      enableControl: true,
      macAddress: "AA:BB:CC:DD:EE:FF",
      controlProfile: "garage",
      triggerModeConfirmed: true,
    },
  ])
    assert.throws(() =>
      parseConfig({ ...config, gates: [{ ...config.gates[0], ...extra }] }),
    );
  assert.throws(() =>
    parseConfig({ ...config, gates: [config.gates[0], config.gates[0]] }),
  );
});
test("custom UI server runs with Homebridge IPC and returns fixed errors without leaking input", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "centsys-ui-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = fork("homebridge-ui/server.js", [], {
    env: { ...process.env, HOMEBRIDGE_STORAGE_PATH: directory },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  t.after(() => child.kill());
  let logs = "";
  child.stdout.on("data", (b) => {
    logs += b;
  });
  child.stderr.on("data", (b) => {
    logs += b;
  });
  await once(child, "message");
  const request = async (path, body) => {
    const response = once(child, "message");
    child.send({ action: "request", requestId: 1, path, body });
    return (await response)[0].payload;
  };
  assert.deepEqual((await request("/status", {})).data, {
    state: "signed-out",
  });
  const result = await request("/auth/send", {
    mobileNumber: "private-invalid-input",
    region: "za",
    channel: "sms",
  });
  assert.equal(result.success, false);
  assert.equal(result.data.error.code, "configuration");
  assert.ok(!JSON.stringify(result).includes("private-invalid-input"));
  assert.ok(!logs.includes("private-invalid-input"));
});
