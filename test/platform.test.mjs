import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { fork } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import hap from "@homebridge/hap-nodejs";
import { PlatformAccessory } from "../node_modules/homebridge/dist/platformAccessory.js";
import { CentsysPlatform } from "../dist/platform.js";
import { parseConfig } from "../dist/settings.js";
import { CentsysError } from "../dist/errors.js";
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
  const packageInfo = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    accessory
      .getService(hap.Service.AccessoryInformation)
      .getCharacteristic(hap.Characteristic.FirmwareRevision).value,
    packageInfo.version,
  );
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
test("HomeKit acknowledges a queued command before delayed telemetry and reports a later failure without retrying", async (t) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let commands = 0;
  const warnings = [];
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
  new CentsysPlatform(
    {
      info: () => {},
      warn: (m) => warnings.push(m),
      error: (m) => assert.fail(m),
    },
    {
      platform: "Centsys",
      gates: [
        {
          name: "Gate",
          serialNumber,
          enableControl: true,
          macAddress: "AA:BB:CC:DD:EE:FF",
          controlProfile: "d5-evo-smart-plus",
          triggerModeConfirmed: true,
        },
      ],
    },
    api,
    {
      gateway: {
        read: async () => [{ serialNumber, state: "closed" }],
        activate: async () => {
          commands++;
          await pending;
          throw new CentsysError("timeout");
        },
      },
    },
  );
  t.after(() => {
    api.emit("shutdown");
    release();
  });
  api.emit("didFinishLaunching");
  await new Promise((r) => setImmediate(r));
  const service = api.registered[0].getService(hap.Service.GarageDoorOpener);
  const target = service.getCharacteristic(hap.Characteristic.TargetDoorState);
  const writing = target.handleSetRequest(0);
  const accepted = await Promise.race([
    writing.then(
      () => true,
      () => false,
    ),
    new Promise((r) => setImmediate(() => r(false))),
  ]);
  assert.equal(
    accepted,
    true,
    "HomeKit must not wait for the delayed MQTT overview",
  );
  assert.equal(
    await service
      .getCharacteristic(hap.Characteristic.CurrentDoorState)
      .handleGetRequest(),
    1,
  );
  assert.equal(await target.handleGetRequest(), 0);
  await assert.rejects(target.handleSetRequest(1));
  assert.equal(commands, 1);
  release();
  await new Promise((r) => setImmediate(r));
  assert.ok(warnings.includes(new CentsysError("timeout").message));
  await assert.rejects(
    service
      .getCharacteristic(hap.Characteristic.CurrentDoorState)
      .handleGetRequest(),
  );
  assert.equal(commands, 1);
});
test("configuration requires the supported control profile and MAC, without a TRG checkbox", () => {
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

test("HomeKit reports failed reads unavailable and recovers all required characteristics without actuation", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  let failed = false;
  let observed = "closed";
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
  new CentsysPlatform(
    { info: () => {}, warn: () => {}, error: (m) => assert.fail(m) },
    config,
    api,
    {
      gateway: {
        read: async () => {
          if (failed) throw new CentsysError("transport");
          return [{ serialNumber, state: observed }];
        },
        activate: async () => assert.fail("Recovery must not actuate"),
      },
    },
  );
  t.after(() => api.emit("shutdown"));
  api.emit("didFinishLaunching");
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  const service = api.registered[0].getService(hap.Service.GarageDoorOpener);
  const types = [
    hap.Characteristic.CurrentDoorState,
    hap.Characteristic.TargetDoorState,
    hap.Characteristic.ObstructionDetected,
  ];
  const values = () =>
    Promise.all(
      types.map((type) => service.getCharacteristic(type).handleGetRequest()),
    );
  assert.deepEqual(await values(), [1, 1, false]);
  failed = true;
  t.mock.timers.tick(15000);
  await flush();
  for (const type of types) {
    const characteristic = service.getCharacteristic(type);
    assert.equal(
      characteristic.statusCode,
      hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
    );
    await assert.rejects(characteristic.handleGetRequest());
  }
  failed = false;
  observed = "open";
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(await values(), [0, 0, false]);
  for (const type of types)
    assert.equal(
      service.getCharacteristic(type).statusCode,
      hap.HAPStatus.SUCCESS,
    );
});

test("live-proof expiry pushes HomeKit unavailable despite continued cached HTTPS success", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  let proof = 100000;
  const api = Object.assign(new EventEmitter(), {
    hap,
    platformAccessory: PlatformAccessory,
    user: { storagePath: () => "/unused" },
    registerPlatformAccessories: (_p, _n, a) => {
      api.registered = a;
    },
    updatePlatformAccessories: () => {},
    unregisterPlatformAccessories: () => {},
  });
  new CentsysPlatform(
    { info: () => {}, warn: () => {}, error: (m) => assert.fail(m) },
    config,
    api,
    {
      gateway: {
        read: async () => [
          { serialNumber, state: "closed", liveVerifiedAt: proof },
        ],
        activate: async () =>
          assert.fail("No commands during expiry or recovery"),
      },
    },
  );
  t.after(() => api.emit("shutdown"));
  const flush = () => new Promise((r) => setImmediate(r));
  api.emit("didFinishLaunching");
  await flush();
  const service = api.registered[0].getService(hap.Service.GarageDoorOpener);
  const types = [
    hap.Characteristic.CurrentDoorState,
    hap.Characteristic.TargetDoorState,
    hap.Characteristic.ObstructionDetected,
  ];
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(15000);
    await flush();
  }
  t.mock.timers.tick(1);
  await flush();
  for (const type of types) {
    const characteristic = service.getCharacteristic(type);
    assert.equal(
      characteristic.statusCode,
      hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      "expiry must push an error without a HomeKit read",
    );
    await assert.rejects(characteristic.handleGetRequest());
  }
  proof = Date.now();
  t.mock.timers.tick(15000);
  await flush();
  for (const type of types)
    assert.equal(
      service.getCharacteristic(type).statusCode,
      hap.HAPStatus.SUCCESS,
    );
  assert.equal(
    await service
      .getCharacteristic(hap.Characteristic.CurrentDoorState)
      .handleGetRequest(),
    1,
  );
});
