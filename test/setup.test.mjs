import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SetupService } from "../dist/setup.js";
import { CentsysError } from "../dist/errors.js";
import { saveSession, readSession } from "../dist/storage.js";
const original = {
  mobileNumber: "+27820000000",
  region: "za",
  token: "original-session",
};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "centsys-setup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 100_000,
    sends = 0,
    verifications = 0,
    reject = false;
  const client = {
    sendOtp: async () => {
      sends++;
    },
    validateOtp: async (code) => {
      verifications++;
      if (code !== "0123") throw new CentsysError("otp-rejected");
      return "new-session-private";
    },
    discover: async () => {
      if (reject) throw new CentsysError("authentication");
      return [];
    },
    overview: async () => [],
  };
  const opts = {
    directory,
    createClient: () => client,
    bootstrap: async () => "bootstrap-private",
    now: () => now,
  };
  return {
    directory,
    opts,
    get sends() {
      return sends;
    },
    get verifications() {
      return verifications;
    },
    advance: () => {
      now += 60_001;
    },
    reject: () => {
      reject = true;
    },
  };
}
test("OTP setup preserves valid sessions on failure, persists only after validation, and survives modal reopen", async (t) => {
  const f = await fixture(t);
  await saveSession(original, f.directory);
  const setup = new SetupService(f.opts);
  const challenge = await setup.sendCode({
    mobileNumber: "+27 820000001",
    region: "za",
    channel: "sms",
  });
  assert.equal(f.sends, 1);
  await assert.rejects(
    setup.verifyCode({ challengeId: challenge.challengeId, code: "9999" }),
    (e) => e.code === "otp-rejected",
  );
  assert.deepEqual(await readSession(f.directory), original);
  assert.deepEqual(
    await setup.verifyCode({
      challengeId: challenge.challengeId,
      code: "0123",
    }),
    { state: "signed-in" },
  );
  const stored = await readSession(f.directory);
  assert.equal(stored.token, "new-session-private");
  assert.equal(stored.mobileNumber, "+27820000001");
  const reopen = new SetupService(f.opts);
  assert.equal((await reopen.status()).state, "signed-in");
  const publicResult = JSON.stringify(await reopen.status());
  assert.ok(!publicResult.includes(stored.token));
  assert.ok(!publicResult.includes(stored.mobileNumber));
  await assert.rejects(
    reopen.verifyCode({ challengeId: challenge.challengeId, code: "0123" }),
  );
  const files = await readdir(f.directory);
  assert.ok(files.every((n) => !n.includes("otp-code")));
  for (const n of files)
    assert.ok(!(await readFile(join(f.directory, n), "utf8")).includes("0123"));
});
test("cooldown survives modal reopen; challenge mismatch and excess attempts never reach authentication", async (t) => {
  const f = await fixture(t);
  let setup = new SetupService(f.opts);
  const request = {
    mobileNumber: original.mobileNumber,
    region: "za",
    channel: "whatsapp",
  };
  let challenge = await setup.sendCode(request);
  setup = new SetupService(f.opts);
  await assert.rejects(
    setup.sendCode(request),
    (e) => e.code === "rate-limited",
  );
  assert.equal(f.sends, 1);
  f.advance();
  challenge = await setup.sendCode(request);
  await assert.rejects(
    setup.verifyCode({ challengeId: "wrong", code: "0123" }),
  );
  assert.equal(f.verifications, 0);
  for (let i = 0; i < 6; i++)
    await assert.rejects(
      setup.verifyCode({ challengeId: challenge.challengeId, code: "9999" }),
    );
  assert.equal(f.verifications, 5);
  assert.equal((await setup.status()).state, "signed-out");
});
test("rejected session appears as sign-in required and logout removes only the local session", async (t) => {
  const f = await fixture(t);
  await saveSession(original, f.directory);
  const setup = new SetupService(f.opts);
  f.reject();
  assert.deepEqual(await setup.status(), { state: "sign-in-required" });
  assert.deepEqual(await readSession(f.directory), original);
  await setup.logout();
  assert.deepEqual(await setup.status(), { state: "signed-out" });
});
