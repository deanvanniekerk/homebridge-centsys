import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSession } from '../auth/storage.js';
import { CentsysError } from '../errors.js';
import { test } from '../test-compat.test-support.js';
import { wifiMacCandidate } from './mac-setup.js';
import { SetupService } from './setup.js';

const input = {
  serialNumber: '00112233445566778899AABB',
  wifiMacAddress: 'AA:BB:CC:DD:EE:FE',
  model: 'd5-evo-smart-plus',
  modelConfirmed: true,
};
const session = {
  mobileNumber: '+27820000000',
  region: 'za',
  token: 'private-test-token',
};
const live = {
  state: 'closed',
  obstruction: null,
  inhibited: false,
  batteryVoltage: 13.4,
};
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'centsys-mac-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await saveSession(session, root);
  return root;
}

test('D5 Wi-Fi candidate uses full-address carry then byte reversal, never truncation or guessing', () => {
  assert.deepEqual(wifiMacCandidate(input), {
    serialNumber: input.serialNumber,
    macAddress: '00:EF:DD:CC:BB:AA',
  });
  for (const patch of [
    { model: 'd5-smart' },
    { modelConfirmed: false },
    { wifiMacAddress: 'FF:FF:FF:FF:FF:FF' },
    { wifiMacAddress: '00:00:00:00:00:00' },
    { wifiMacAddress: 'AA:BB:CC:DD:EE:XX' },
    { serialNumber: 'short' },
  ])
    assert.throws(
      () => wifiMacCandidate({ ...input, ...patch }),
      (e) => e.code === 'configuration',
    );
});

test('setup returns an address only after one identity-only live verification and does not save it', async (t) => {
  const root = await directory(t);
  let calls = 0;
  const setup = new SetupService({
    directory: root,
    createClient: () => ({
      certificate: async () => ({ pfx: Buffer.from('test'), password: 'test' }),
    }),
    verifySession: async (options) => {
      calls++;
      assert.equal(options.target, undefined);
      assert.equal(options.beforeActivation, undefined);
      assert.equal(options.macAddress, '00:EF:DD:CC:BB:AA');
      return { live, activated: false };
    },
  });
  assert.deepEqual(await setup.verifyWifiAddress(input), {
    serialNumber: input.serialNumber,
    macAddress: '00:EF:DD:CC:BB:AA',
    state: 'closed',
    verified: true,
  });
  assert.equal(calls, 1);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(root), ['session.json']);
});

test('verification rejects unsupported region, failed identity, missing telemetry and changed account without another attempt', async (t) => {
  const root = await directory(t);
  let calls = 0;
  let failure = 'gate-authentication';
  const setup = new SetupService({
    directory: root,
    createClient: () => ({
      certificate: async () => ({ pfx: Buffer.from('test'), password: 'test' }),
    }),
    verifySession: async () => {
      calls++;
      if (failure === 'account') {
        await saveSession({ ...session, token: 'changed' }, root);
        return { live, activated: false };
      }
      if (failure === 'unknown') return { live: { ...live, state: 'unknown' }, activated: false };
      throw new CentsysError(failure);
    },
  });
  for (const code of ['gate-authentication', 'timeout', 'unknown', 'account']) {
    failure = code;
    await assert.rejects(
      setup.verifyWifiAddress(input),
      (e) => e.code === ({ unknown: 'state-unavailable', account: 'authentication' }[code] ?? code),
    );
  }
  assert.equal(calls, 4);
  await saveSession({ ...session, region: 'au' }, root);
  await assert.rejects(setup.verifyWifiAddress(input), (e) => e.code === 'control-disabled');
  assert.equal(calls, 4);
});
