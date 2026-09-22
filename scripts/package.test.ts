import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { test } from '../src/test-compat.test-support.js';

test('npm tarball includes nested runtime and UI outputs without source or private captures', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const files = new Set(pack.files.map((file: { path: string }) => file.path));
  for (const path of [
    'dist/index.js',
    'dist/cloud/client.js',
    'dist/auth/storage.js',
    'dist/gate/gateway.js',
    'dist/homebridge/platform.js',
    'homebridge-ui/server.js',
    'homebridge-ui/public/app.js',
    'resources/centsys-ca.crt',
    'config.schema.json',
    'docs/PROJECT_STRUCTURE.md',
    'docs/VALIDATION.md',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    assert.ok(files.has(path), `${path} missing from package`);
  }
  assert.ok([...files].every((path) => !path.endsWith('.ts')));
  assert.ok([...files].every((path) => !path.startsWith('docs/validation/')));
  assert.ok([...files].every((path) => !path.startsWith('.local/')));
  assert.doesNotThrow(() => new Script(readFileSync('homebridge-ui/public/app.js', 'utf8')));
});
