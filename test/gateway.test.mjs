import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudGateway } from "../dist/gateway.js";
import { saveSession } from "../dist/storage.js";
import { CentsysError } from "../dist/errors.js";
const gate = {
  name: "Gate",
  serialNumber: "00112233445566778899AABB",
  macAddress: "AA:BB:CC:DD:EE:FF",
  enableControl: true,
};
const live = {
  state: "closed",
  obstruction: null,
  inhibited: false,
  batteryVoltage: 13.4,
};
async function setup(t, runSession) {
  const directory = await mkdtemp(join(tmpdir(), "centsys-gateway-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await saveSession(
    { mobileNumber: "+27820000000", region: "za", token: "fake" },
    directory,
  );
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    if (path === "/GetCertificate")
      return Response.json({ pfxBase64: "AAAA", password: "fake" });
    assert.equal(path, "/GetOperatorOverview");
    return Response.json([
      { operatorSerialNumber: gate.serialNumber, operatorStatus: 2 },
    ]);
  });
  return new CloudGateway(directory, undefined, { runSession });
}
test("cached HTTPS Closed cannot keep an offline controller available", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  let probes = 0,
    offline = false;
  const gateway = await setup(t, async (options) => {
    probes++;
    assert.equal(options.target, undefined);
    if (offline) throw new CentsysError("timeout");
    return { live, activated: false };
  });
  const signal = new AbortController().signal;
  const first = await gateway.read([gate], signal);
  assert.equal(probes, 1);
  assert.equal(first[0].liveVerifiedAt, 100000);
  t.mock.timers.tick(15000);
  assert.equal(
    (await gateway.read([gate], signal))[0].liveVerifiedAt,
    100000,
    "HTTP receipt cannot renew live proof",
  );
  assert.equal(probes, 1);
  offline = true;
  t.mock.timers.tick(15001);
  await assert.rejects(
    gateway.read([gate], signal),
    (e) => e.code === "timeout",
  );
  assert.equal(probes, 2);
  offline = false;
  assert.equal((await gateway.read([gate], signal))[0].state, "closed");
  assert.equal(probes, 3);
});
test("monitoring without a validated address cannot expose cached state as available", async (t) => {
  const gateway = await setup(t, async () =>
    assert.fail("No identity without an address"),
  );
  await assert.rejects(
    gateway.read(
      [{ ...gate, macAddress: undefined }],
      new AbortController().signal,
    ),
    (e) => e.code === "state-unavailable",
  );
});

test("control cancels monitoring and waits for MQTT teardown before connecting", async (t) => {
  let started, release;
  const monitoringStarted = new Promise((r) => {
    started = r;
  });
  const cleanup = new Promise((r) => {
    release = r;
  });
  let monitorAborted = false,
    commands = 0;
  const gateway = await setup(t, async (options) => {
    if (options.target === undefined) {
      started();
      await new Promise((resolve) =>
        options.signal.addEventListener("abort", resolve, { once: true }),
      );
      monitorAborted = true;
      await cleanup;
      throw new CentsysError("cancelled");
    }
    commands++;
    assert.equal(monitorAborted, true);
    options.onState(live);
    await options.beforeActivation();
    return { live, activated: false };
  });
  const signal = new AbortController().signal;
  const read = gateway.read([gate], signal);
  const rejected = assert.rejects(read, (e) => e.code === "cancelled");
  await monitoringStarted;
  const command = gateway.activate(gate, "closed", signal, () => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(commands, 0, "command cannot overlap monitoring teardown");
  await assert.rejects(gateway.read([gate], signal), (e) => e.code === "busy");
  release();
  await rejected;
  assert.equal((await command).activated, false);
  assert.equal(commands, 1);
});
test("changed credentials or protocol address cannot reuse earlier live proof", async (t) => {
  let probes = 0;
  const gateway = await setup(t, async () => {
    probes++;
    return { live, activated: false };
  });
  const signal = new AbortController().signal;
  await gateway.read([gate], signal);
  await saveSession(
    { mobileNumber: "+27820000000", region: "za", token: "replacement" },
    gateway.directory,
  );
  await gateway.read([gate], signal);
  assert.equal(probes, 2);
  await gateway.read([{ ...gate, macAddress: "AA:BB:CC:DD:EE:00" }], signal);
  assert.equal(probes, 3);
});

test("a UI session lease blocks runtime monitoring and activation before MQTT connects", async (t) => {
  const { withSessionLock } = await import("../dist/session-lock.js");
  const gateway = await setup(t, async () =>
    assert.fail("Competing MQTT connection"),
  );
  const signal = new AbortController().signal;
  await withSessionLock(gateway.directory, signal, async () => {
    await assert.rejects(
      gateway.read([gate], signal),
      (e) => e.code === "busy",
    );
    await assert.rejects(
      gateway.activate(gate, "open", signal, () => {}),
      (e) => e.code === "busy",
    );
  });
});
