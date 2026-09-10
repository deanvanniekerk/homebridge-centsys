import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  identityPacket,
  decodeGateTelemetry,
  needsTrigger,
} from "../dist/mqtt-codec.js";
import { gateSession } from "../dist/mqtt-session.js";
const mac = "AA:BB:CC:DD:EE:FF";
const options = {
  session: { mobileNumber: "+27820000000", region: "za", token: "fake" },
  serialNumber: "00112233445566778899AABB",
  macAddress: mac,
  certificate: { pfx: Buffer.from("fake"), password: "fake" },
  timeoutMs: 100,
};
const header = (type, body = Buffer.alloc(0)) =>
  Buffer.concat([Buffer.from([1, 1, type, 0]), body]);
function telemetry(state = 1) {
  const b = Buffer.alloc(68);
  b.writeUInt16LE(1340, 4);
  b[26] = state;
  return b;
}
function broker({
  dropAck = false,
  reject = false,
  onActivate,
  retain = false,
  beforeTimeAck,
  timeReply = header(6),
} = {}) {
  const client = new EventEmitter();
  const sent = [];
  let ended = false;
  client.end = () => {
    ended = true;
  };
  client.subscribe = (topics, _opts, cb) =>
    queueMicrotask(() =>
      cb(
        null,
        topics.map((topic) => ({ topic, qos: 0 })),
      ),
    );
  const incoming = (suffix, data) => {
    if (!ended)
      client.emit("message", `${options.serialNumber}/${suffix}`, data, {
        retain,
      });
  };
  client.publish = (topic, data, opts, cb) => {
    sent.push({ topic, data, opts });
    queueMicrotask(() => {
      cb?.();
      if (topic.endsWith("/connectionRequest"))
        incoming("connectionRequestResponse", Buffer.from([1]));
      else if (data[2] === 1) {
        incoming("userRemoteTriggerResponse", header(2, Buffer.alloc(8)));
        incoming("deviceOverview", telemetry());
      } else if (data[2] === 5) {
        beforeTimeAck?.(incoming);
        incoming("userRemoteTriggerResponse", timeReply);
      } else if (data[2] === 3) {
        onActivate?.();
        if (!dropAck) {
          const k = Buffer.from("9223f3674dbfab9c", "hex");
          incoming(
            "userRemoteTriggerResponse",
            header(4, Buffer.from([k[0], k[1] ^ (reject ? 7 : 1)])),
          );
        }
      }
    });
  };
  return {
    sent,
    connect: (opts) => {
      assert.equal(opts.rejectUnauthorized, true);
      assert.equal(opts.reconnectPeriod, 0);
      queueMicrotask(() => client.emit("connect"));
      return client;
    },
  };
}
test("identity codec agrees with pinned Python reference for a synthetic account", () => {
  assert.equal(
    identityPacket(options.session.mobileNumber, mac).toString("hex"),
    "010101009223f3674dbf8b1b9023f367",
  );
});
test("D5 telemetry maps independently from HTTP and rejects foreign layouts or nonzero padding", () => {
  assert.equal(decodeGateTelemetry(telemetry()).state, "closed");
  assert.equal(decodeGateTelemetry(telemetry()).obstruction, null);
  assert.equal(decodeGateTelemetry(telemetry(4)).state, "opening");
  assert.throws(() => decodeGateTelemetry(Buffer.alloc(28)));
  const b = telemetry();
  b[67] = 1;
  assert.throws(() => decodeGateTelemetry(b));
  const moving = {
    state: "closing",
    obstruction: false,
    inhibited: false,
    batteryVoltage: 13.4,
  };
  assert.throws(() => needsTrigger("open", moving));
  assert.equal(needsTrigger("closed", moving), false);
  assert.throws(() =>
    needsTrigger("open", { ...moving, state: "closed", inhibited: true }),
  );
});
test("read-only session sends identity with correct reply topic and never time or activation packets", async () => {
  const b = broker();
  const r = await gateSession({ ...options, connect: b.connect });
  assert.equal(r.activated, false);
  assert.equal(r.live.state, "closed");
  const identity = b.sent.find((x) => x.data[2] === 1);
  assert.ok(
    identity.opts.properties.responseTopic.endsWith(
      "/userRemoteTriggerResponse",
    ),
  );
  assert.equal(b.sent.filter((x) => [3, 5].includes(x.data[2])).length, 0);
});
test("activation is single QoS 0 publish; rejection and lost acknowledgement never cause retries", async () => {
  for (const mode of ["accepted", "rejected", "lost"]) {
    const b = broker({ reject: mode === "rejected", dropAck: mode === "lost" });
    const p = gateSession({ ...options, target: "open", connect: b.connect });
    if (mode === "accepted") assert.equal((await p).activated, true);
    else
      await assert.rejects(
        p,
        (e) =>
          e.code ===
          (mode === "rejected" ? "command-rejected" : "command-uncertain"),
      );
    const commands = b.sent.filter((x) => x.data[2] === 3);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].opts.qos, 0);
    assert.equal(commands[0].opts.retain, false);
  }
});
test("observed eight-byte time reply reaches the pre-activation check without relaxing other headers", async () => {
  for (const [flag, length, reachesCheck] of [
    [0x20, 8, true],
    [0x20, 4, false],
    [0x40, 8, false],
  ]) {
    const reply = Buffer.alloc(length);
    reply.set([1, 1, 6, flag]);
    const b = broker({ timeReply: reply });
    let checked = false;
    await assert.rejects(
      gateSession({
        ...options,
        connect: b.connect,
        target: "open",
        beforeActivation: async () => {
          checked = true;
          throw new Error("Blocked by test");
        },
      }),
    );
    assert.equal(checked, reachesCheck);
    assert.equal(b.sent.filter((p) => p.data[2] === 3).length, 0);
  }
});
test("already satisfied target, retained responses, logout check and changed gate state prevent activation", async () => {
  for (const mode of ["satisfied", "retained", "logout", "moving"]) {
    const b = broker({
      retain: mode === "retained",
      beforeTimeAck:
        mode === "moving"
          ? (incoming) => incoming("deviceOverview", telemetry(5))
          : undefined,
    });
    const p = gateSession({
      ...options,
      target: mode === "satisfied" ? "closed" : "open",
      connect: b.connect,
      beforeActivation:
        mode === "logout"
          ? async () => {
              throw Error("session changed");
            }
          : undefined,
    });
    if (mode === "satisfied") assert.equal((await p).activated, false);
    else await assert.rejects(p);
    assert.equal(b.sent.filter((x) => x.data[2] === 3).length, 0);
  }
});
