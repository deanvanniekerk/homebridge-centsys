import assert from 'node:assert/strict';
import { CentsysError } from '../errors.js';
import { test } from '../test-compat.test-support.js';
import { decodeDevices, decodeOverviews } from './cloud-protocol.js';

const secretSerial = 'fixture-private-serial';
const device = {
  serialNumber: secretSerial,
  productCode: 32,
  productType: 50,
  isWifiDevice: true,
  deviceWiFiStatus: { isOnline: true },
};
const status = {
  operatorSerialNumber: secretSerial,
  operatorStatus: 2,
  closingBeamStatus: 0,
};
const expectCode = (code: string) => (error: unknown) =>
  error instanceof CentsysError && error.code === code;

test('cloud discovery keeps its 256-row bound', () => {
  assert.throws(
    () => decodeDevices(Array.from({ length: 257 }, () => ({ serialNumber: secretSerial }))),
    (error: unknown) =>
      error instanceof CentsysError && error.diagnostic.reason === 'too-many-rows',
  );
});

test('all HTTPS states decode independently of MQTT and unknown codes remain unknown', () => {
  const requested = new Set([secretSerial]);
  const labels = [
    'unknown',
    'open',
    'closed',
    'partly-open',
    'partly-closed',
    'opening',
    'closing',
  ];
  for (const [code, label] of labels.entries())
    assert.equal(decodeOverviews([{ ...status, operatorStatus: code }], requested)[0].state, label);
  for (const code of [null, undefined, -1, 99])
    assert.equal(
      decodeOverviews([{ ...status, operatorStatus: code }], requested)[0].state,
      'unknown',
    );
  for (const code of ['2', true, 1.5])
    assert.throws(
      () => decodeOverviews([{ ...status, operatorStatus: code }], requested),
      expectCode('protocol'),
    );
});

test('ambiguous identities and malformed telemetry fail closed; missing rows remain missing', () => {
  for (const rows of [
    [device, device],
    [{}],
    [null],
    [[], device],
    [{ ...device, serialNumber: '' }],
    [{ ...device, isWifiDevice: 'false' }],
    [{ ...device, deviceWiFiStatus: { isOnline: 'false' } }],
  ]) {
    assert.throws(() => decodeDevices(rows), expectCode('protocol'));
  }
  const requested = new Set([secretSerial]);
  assert.throws(() => decodeOverviews([status, status], requested), expectCode('protocol'));
  assert.throws(
    () => decodeOverviews([{ ...status, operatorSerialNumber: 'another-device' }], requested),
    expectCode('protocol'),
  );
  assert.deepEqual(decodeOverviews([], requested), []);
  assert.equal(decodeDevices([{ serialNumber: secretSerial }])[0].online, null);
});

test('discovery retains only valid protocol MACs without converting Wi-Fi addresses', () => {
  for (const value of ['aa:bb:cc:dd:ee:01', 'aabbccddee01']) {
    assert.equal(
      decodeDevices([{ ...device, macAddress: value }])[0].macAddress,
      'AA:BB:CC:DD:EE:01',
    );
  }
  for (const value of [undefined, null, '', 'not-a-mac', 123, 'AA:BB:CC:DD:EE:FF:00']) {
    const [result] = decodeDevices([
      {
        ...device,
        macAddress: value,
        deviceWiFiStatus: { macAddress: 'AA:BB:CC:DD:EE:02' },
      },
    ]);
    assert.equal(result.macAddress, undefined);
  }
});
