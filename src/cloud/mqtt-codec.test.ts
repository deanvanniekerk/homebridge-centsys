import assert from 'node:assert/strict';
import { test } from '../test-compat.test-support.js';
import { decodeGateTelemetry, identityPacket, needsTrigger } from './mqtt-codec.js';

const mac = 'AA:BB:CC:DD:EE:FF';
const mobileNumber = '+27820000000';
function telemetry(state = 1) {
  const b = Buffer.alloc(68);
  b.writeUInt16LE(1340, 4);
  b[26] = state;
  return b;
}

test('identity codec agrees with pinned Python reference for a synthetic account', () => {
  assert.equal(
    identityPacket(mobileNumber, mac).toString('hex'),
    '010101009223f3674dbf8b1b9023f367',
  );
});
test('D5 telemetry maps independently from HTTP and rejects foreign layouts or nonzero padding', () => {
  assert.equal(decodeGateTelemetry(telemetry()).state, 'closed');
  assert.equal(decodeGateTelemetry(telemetry()).obstruction, null);
  assert.equal(decodeGateTelemetry(telemetry(4)).state, 'opening');
  assert.throws(() => decodeGateTelemetry(Buffer.alloc(28)));
  const b = telemetry();
  b[67] = 1;
  assert.throws(() => decodeGateTelemetry(b));
  const moving = {
    state: 'closing',
    obstruction: false,
    inhibited: false,
    batteryVoltage: 13.4,
  };
  assert.throws(() => needsTrigger('open', moving));
  assert.equal(needsTrigger('closed', moving), false);
  assert.throws(() => needsTrigger('open', { ...moving, state: 'closed', inhibited: true }));
});
