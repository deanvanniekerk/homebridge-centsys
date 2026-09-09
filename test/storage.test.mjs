import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { forgetSession, readSession, saveSession } from "../dist/storage.js";

const session = {
  mobileNumber: "+27820000000",
  region: "za",
  token: "fixture-private-session",
};
const storageError = (error) =>
  error.code === "local-storage" && !error.message.includes(session.token);
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "centsys-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("sessions round-trip through owner-only files and logout is local/idempotent", async (t) => {
  const path = await directory(t);
  await saveSession(session, path);
  assert.equal((await stat(path)).mode & 0o777, 0o700);
  assert.equal((await stat(join(path, "session.json"))).mode & 0o777, 0o600);
  assert.deepEqual(await readSession(path), session);
  await saveSession({ ...session, token: "replacement" }, path);
  assert.equal((await readSession(path)).token, "replacement");
  await forgetSession(path);
  await forgetSession(path);
  await assert.rejects(readSession(path), storageError);
});

test("world-readable, malformed and symlinked credentials are rejected", async (t) => {
  const path = await directory(t);
  await saveSession(session, path);
  const file = join(path, "session.json");
  await chmod(file, 0o644);
  await assert.rejects(readSession(path), storageError);
  await chmod(file, 0o600);
  await writeFile(
    file,
    JSON.stringify({ version: 1, ...session, region: "wrong" }),
  );
  await assert.rejects(readSession(path), storageError);
  await rm(file);
  const target = join(path, "untouched");
  await writeFile(target, "untouched", { mode: 0o600 });
  await symlink(target, file);
  await assert.rejects(readSession(path), storageError);
  await saveSession(session, path);
  assert.equal(await readFile(target, "utf8"), "untouched");
  assert.deepEqual(await readSession(path), session);
});
