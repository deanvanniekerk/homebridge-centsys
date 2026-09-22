import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CentsysError } from '../errors.js';
import { test } from '../test-compat.test-support.js';
import { withSessionLock } from './session-lock.js';

async function directory(t: { after(callback: () => Promise<unknown>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'centsys-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('session lock excludes a separate process and releases after failure', async (t) => {
  const root = await directory(t);
  const compiled = new URL('../../dist/auth/session-lock.js', import.meta.url);
  try {
    await access(compiled);
  } catch {
    const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
    assert.equal(build.status, 0);
  }
  const moduleUrl = compiled.href;
  await withSessionLock(root, new AbortController().signal, async () => {
    const child = fork(
      '--input-type=module',
      [
        '-e',
        `import {withSessionLock} from ${JSON.stringify(moduleUrl)}; try {await withSessionLock(process.argv[1],new AbortController().signal,async()=>process.send('entered'));} catch(e){process.send(e.code);} process.disconnect();`,
        root,
      ],
      { silent: true },
    );
    t.after(() => child.kill());
    const [message] = await once(child, 'message');
    assert.equal(message, 'busy');
    await once(child, 'exit');
  });
  await assert.rejects(
    withSessionLock(root, new AbortController().signal, async () => {
      throw new CentsysError('timeout');
    }),
    (e) => e.code === 'timeout',
  );
  assert.equal(await withSessionLock(root, new AbortController().signal, async () => 42), 42);
});
