import test from "node:test";
import assert from "node:assert/strict";
import { GateCoordinator } from "../dist/coordinator.js";
import { CentsysError } from "../dist/errors.js";
const gate = {
  name: "Gate",
  serialNumber: "00112233445566778899AABB",
  enableControl: true,
  macAddress: "AA:BB:CC:DD:EE:FF",
};
const row = (state) => ({
  serialNumber: gate.serialNumber,
  state,
  stateCode: 2,
  powerSupplyCode: null,
  closingBeamCode: null,
  openingBeamCode: null,
  theftAlarmCode: null,
});
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("unavailable on startup, missing overview, network failure and stale data; never manufactures a closed state", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  let response = [row("closed")],
    failure = false;
  const gateway = {
    read: async () => {
      if (failure) throw new CentsysError("authentication");
      return response;
    },
    activate: async () => {
      throw Error("Unexpected command");
    },
  };
  const c = new GateCoordinator([gate], gateway, 15);
  t.after(() => c.close());
  assert.equal(c.snapshot(gate.serialNumber).state, "unknown");
  await c.refresh();
  assert.equal(c.snapshot(gate.serialNumber).state, "closed");
  t.mock.timers.tick(45001);
  assert.equal(c.snapshot(gate.serialNumber).state, "unknown");
  response = [];
  await c.refresh();
  assert.equal(c.snapshot(gate.serialNumber).state, "unknown");
  failure = true;
  await c.refresh();
  assert.equal(c.snapshot(gate.serialNumber).error, "authentication");
});
test("one account command at a time; ambiguous failure is not retried and pre-command HTTP cannot overwrite MQTT", async (t) => {
  const pending = deferred(),
    activation = deferred();
  let count = 0;
  const gateway = {
    read: () => pending.promise,
    activate: async (_g, _t, _s, onState) => {
      count++;
      onState({
        state: "opening",
        obstruction: null,
        batteryVoltage: 13.4,
        inhibited: false,
      });
      await activation.promise;
      throw new CentsysError("command-uncertain");
    },
  };
  const c = new GateCoordinator([gate], gateway, 15);
  t.after(() => c.close());
  const reading = c.refresh();
  const command = c.setTarget(gate.serialNumber, "open");
  assert.equal(count, 1, "a slow HTTP read does not delay activation");
  await assert.rejects(
    c.setTarget(gate.serialNumber, "closed"),
    (e) => e.code === "busy",
  );
  pending.resolve([row("closed")]);
  await reading;
  await new Promise((r) => setImmediate(r));
  assert.equal(c.snapshot(gate.serialNumber).state, "opening");
  assert.equal(count, 1);
  activation.resolve();
  await assert.rejects(command, (e) => e.code === "command-uncertain");
  assert.equal(count, 1);
  assert.equal(c.snapshot(gate.serialNumber).state, "unknown");
});
test("HTTP success or failure started before a completed command cannot replace its live state", async (t) => {
  for (const fail of [false, true]) {
    const pending = deferred();
    const c = new GateCoordinator(
      [gate],
      {
        read: async () => {
          await pending.promise;
          if (fail) throw new CentsysError("transport");
          return [row("closed")];
        },
        activate: async (_g, _t, _s, onState) => {
          const live = {
            state: "opening",
            obstruction: false,
            batteryVoltage: 13.4,
            inhibited: false,
          };
          onState(live);
          return { live, activated: true };
        },
      },
      15,
    );
    t.after(() => c.close());
    const reading = c.refresh();
    await c.setTarget(gate.serialNumber, "open");
    pending.resolve();
    await reading;
    assert.equal(c.snapshot(gate.serialNumber).state, "opening");
    assert.equal(c.snapshot(gate.serialNumber).target, "open");
  }
});
test("control stays disabled by default and shutdown prevents further activation", async () => {
  let commands = 0;
  const c = new GateCoordinator(
    [{ ...gate, enableControl: false }],
    {
      read: async () => [],
      activate: async () => {
        commands++;
      },
    },
    15,
  );
  await assert.rejects(
    c.setTarget(gate.serialNumber, "open"),
    (e) => e.code === "control-disabled",
  );
  c.close();
  assert.equal(commands, 0);
});
test("queued jobs have a 30-second deadline, cancel on shutdown, and never retry", async (t) => {
  for (const reason of ["timeout", "shutdown"]) {
    const deadline = new AbortController();
    t.mock.method(AbortSignal, "timeout", (ms) => {
      assert.equal(ms, 30_000);
      return deadline.signal;
    });
    const reported = deferred();
    let commands = 0;
    const c = new GateCoordinator(
      [gate],
      {
        read: async () => [row("closed")],
        activate: async (_g, _target, signal) => {
          commands++;
          await new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new CentsysError("cancelled")),
              { once: true },
            ),
          );
        },
      },
      15,
    );
    await c.refresh();
    c.requestTarget(gate.serialNumber, "open", reported.resolve);
    assert.equal(c.snapshot(gate.serialNumber).state, "closed");
    assert.equal(c.snapshot(gate.serialNumber).target, "open");
    if (reason === "timeout") deadline.abort();
    else c.close();
    assert.equal(
      (await reported.promise).code,
      reason === "timeout" ? "timeout" : "cancelled",
    );
    assert.equal(commands, 1);
    assert.equal(c.snapshot(gate.serialNumber).state, "unknown");
    c.close();
    t.mock.restoreAll();
  }
});

test("poll failures back off, recovery resumes normal cadence, and polling never actuates", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 100000 });
  let unavailable = true;
  let reads = 0;
  const c = new GateCoordinator(
    [gate],
    {
      read: async () => {
        reads++;
        if (unavailable) throw new CentsysError("transport");
        return [row("closed")];
      },
      activate: async () => assert.fail("Polling must not activate"),
    },
    15,
  );
  t.after(() => c.close());
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  c.start();
  await flush();
  assert.equal(reads, 1);
  assert.equal(c.snapshot(gate.serialNumber).error, "transport");
  for (const delay of [30000, 60000, 120000, 240000, 300000, 300000]) {
    const before = reads;
    t.mock.timers.tick(delay - 1);
    await flush();
    assert.equal(reads, before);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(reads, before + 1);
  }
  unavailable = false;
  t.mock.timers.tick(300000);
  await flush();
  assert.equal(c.snapshot(gate.serialNumber).state, "closed");
  assert.equal(c.snapshot(gate.serialNumber).error, undefined);
  const recovered = reads;
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(reads, recovered + 1);
  c.close();
  t.mock.timers.tick(300000);
  await flush();
  assert.equal(reads, recovered + 1);
});

test("target reconciles at endpoint or expires, and recovery never replays an uncertain command", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100000 });
  for (const outcome of ["endpoint", "stalled", "uncertain"]) {
    let observed = "closed";
    let commands = 0;
    const c = new GateCoordinator(
      [gate],
      {
        read: async () => [row(observed)],
        activate: async (_g, _t, _s, onState) => {
          commands++;
          const live = {
            state: "closed",
            obstruction: null,
            inhibited: false,
            batteryVoltage: 13.4,
          };
          onState(live);
          if (outcome === "uncertain")
            throw new CentsysError("command-uncertain");
          return { live, activated: true };
        },
      },
      15,
    );
    await c.refresh();
    const command = c.setTarget(gate.serialNumber, "open");
    if (outcome === "uncertain")
      await assert.rejects(command, (e) => e.code === "command-uncertain");
    else await command;
    if (outcome === "endpoint") observed = "open";
    if (outcome === "stalled") t.mock.timers.tick(60001);
    await c.refresh();
    const state = c.snapshot(gate.serialNumber);
    assert.equal(state.state, observed);
    assert.equal(state.target, undefined);
    assert.equal(state.error, undefined);
    assert.equal(commands, 1);
    c.close();
  }
});
