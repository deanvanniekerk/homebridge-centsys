import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { wifiMacCandidate } from "../dist/mac-setup.js";
import { SetupService } from "../dist/setup.js";
import { saveSession } from "../dist/storage.js";
import { withSessionLock } from "../dist/session-lock.js";
import { CentsysError } from "../dist/errors.js";
const input = {
  serialNumber: "00112233445566778899AABB",
  wifiMacAddress: "AA:BB:CC:DD:EE:FE",
  model: "d5-evo-smart-plus",
  modelConfirmed: true,
};
const session = {
  mobileNumber: "+27820000000",
  region: "za",
  token: "private-test-token",
};
const live = {
  state: "closed",
  obstruction: null,
  inhibited: false,
  batteryVoltage: 13.4,
};
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), "centsys-mac-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await saveSession(session, root);
  return root;
}

test("D5 Wi-Fi candidate uses full-address carry then byte reversal, never truncation or guessing", () => {
  assert.deepEqual(wifiMacCandidate(input), {
    serialNumber: input.serialNumber,
    macAddress: "00:EF:DD:CC:BB:AA",
  });
  for (const patch of [
    { model: "d5-smart" },
    { modelConfirmed: false },
    { wifiMacAddress: "FF:FF:FF:FF:FF:FF" },
    { wifiMacAddress: "00:00:00:00:00:00" },
    { wifiMacAddress: "AA:BB:CC:DD:EE:XX" },
    { serialNumber: "short" },
  ])
    assert.throws(
      () => wifiMacCandidate({ ...input, ...patch }),
      (e) => e.code === "configuration",
    );
});

test("setup returns an address only after one identity-only live verification and does not save it", async (t) => {
  const root = await directory(t);
  let calls = 0;
  const setup = new SetupService({
    directory: root,
    createClient: () => ({
      certificate: async () => ({ pfx: Buffer.from("test"), password: "test" }),
    }),
    verifySession: async (options) => {
      calls++;
      assert.equal(options.target, undefined);
      assert.equal(options.beforeActivation, undefined);
      assert.equal(options.macAddress, "00:EF:DD:CC:BB:AA");
      return { live, activated: false };
    },
  });
  assert.deepEqual(await setup.verifyWifiAddress(input), {
    serialNumber: input.serialNumber,
    macAddress: "00:EF:DD:CC:BB:AA",
    state: "closed",
    verified: true,
  });
  assert.equal(calls, 1);
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(root), ["session.json"]);
});

test("verification rejects unsupported region, failed identity, missing telemetry and changed account without another attempt", async (t) => {
  const root = await directory(t);
  let calls = 0;
  let failure = "gate-authentication";
  const setup = new SetupService({
    directory: root,
    createClient: () => ({
      certificate: async () => ({ pfx: Buffer.from("test"), password: "test" }),
    }),
    verifySession: async () => {
      calls++;
      if (failure === "account") {
        await saveSession({ ...session, token: "changed" }, root);
        return { live, activated: false };
      }
      if (failure === "unknown")
        return { live: { ...live, state: "unknown" }, activated: false };
      throw new CentsysError(failure);
    },
  });
  for (const code of ["gate-authentication", "timeout", "unknown", "account"]) {
    failure = code;
    await assert.rejects(
      setup.verifyWifiAddress(input),
      (e) =>
        e.code ===
        ({ unknown: "state-unavailable", account: "authentication" }[code] ??
          code),
    );
  }
  assert.equal(calls, 4);
  await saveSession({ ...session, region: "au" }, root);
  await assert.rejects(
    setup.verifyWifiAddress(input),
    (e) => e.code === "control-disabled",
  );
  assert.equal(calls, 4);
});

test("session lock excludes a separate process and releases after failure", async (t) => {
  const root = await directory(t);
  const moduleUrl = new URL("../dist/session-lock.js", import.meta.url).href;
  await withSessionLock(root, new AbortController().signal, async () => {
    const child = fork(
      "--input-type=module",
      [
        "-e",
        `import {withSessionLock} from ${JSON.stringify(moduleUrl)}; try {await withSessionLock(process.argv[1],new AbortController().signal,async()=>process.send('entered'));} catch(e){process.send(e.code);} process.disconnect();`,
        root,
      ],
      { silent: true },
    );
    t.after(() => child.kill());
    const [message] = await once(child, "message");
    assert.equal(message, "busy");
    await once(child, "exit");
  });
  await assert.rejects(
    withSessionLock(root, new AbortController().signal, async () => {
      throw new CentsysError("timeout");
    }),
    (e) => e.code === "timeout",
  );
  assert.equal(
    await withSessionLock(root, new AbortController().signal, async () => 42),
    42,
  );
});
