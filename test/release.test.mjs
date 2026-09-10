import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("release guard requires exact approval and the matching public registry/channel", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "centsys-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await copyFile(
    new URL("../scripts/check-release.mjs", import.meta.url),
    join(root, "scripts/check-release.mjs"),
  );
  async function check(version, tag, approved, overrides = {}) {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "homebridge-centsys",
        version,
        publishConfig: {
          access: "public",
          registry: "https://registry.npmjs.org/",
          tag,
        },
        ...overrides,
      }),
    );
    const env = { ...process.env };
    delete env.CENTSYS_RELEASE_APPROVED;
    if (approved !== undefined) env.CENTSYS_RELEASE_APPROVED = approved;
    return spawnSync(
      process.execPath,
      [join(root, "scripts/check-release.mjs")],
      { env, encoding: "utf8", timeout: 5000 },
    ).status;
  }
  for (const [version, tag] of [
    ["0.1.0-alpha.8", "alpha"],
    ["0.1.0-beta.1", "beta"],
    ["1.0.0", "latest"],
  ]) {
    assert.equal(await check(version, tag, version), 0);
    assert.notEqual(await check(version, tag, undefined), 0);
    assert.notEqual(await check(version, tag, "different-version"), 0);
  }
  assert.notEqual(await check("0.1.0-alpha.8", "latest", "0.1.0-alpha.8"), 0);
  assert.notEqual(await check("1.0.0", "beta", "1.0.0"), 0);
  assert.notEqual(await check("01.0.0", "latest", "01.0.0"), 0);
  assert.notEqual(await check("1.0.0-rc.1", "latest", "1.0.0-rc.1"), 0);
  assert.notEqual(
    await check("1.0.0", "latest", "1.0.0", { private: true }),
    0,
  );
  assert.notEqual(
    await check("1.0.0", "latest", "1.0.0", {
      publishConfig: {
        access: "restricted",
        registry: "https://registry.npmjs.org/",
        tag: "latest",
      },
    }),
    0,
  );
  assert.notEqual(
    await check("1.0.0", "latest", "1.0.0", {
      publishConfig: {
        access: "public",
        registry: "https://example.invalid/",
        tag: "latest",
      },
    }),
    0,
  );
});
