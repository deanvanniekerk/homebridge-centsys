import assert from 'node:assert/strict';
import { test } from '../test-compat.test-support.js';
import { timePacket } from './mqtt-codec.js';
import { controllerTimeZone, isTimeZone, wallClock } from './time-zone.js';

const mac = 'AA:BB:CC:DD:EE:FF';

test('wall clock follows the zone, including half-hour offsets and daylight saving', () => {
  // Sunday 5 January 2025 23:30 UTC.
  const summer = new Date(Date.UTC(2025, 0, 5, 23, 30, 15));
  assert.deepEqual(wallClock(summer, 'Africa/Johannesburg'), {
    second: 15,
    minute: 30,
    hour: 1,
    weekday: 0, // Monday
    day: 6,
    month: 0,
    year: 2025,
  });
  assert.equal(wallClock(summer, 'Australia/Sydney').hour, 10); // AEDT +11
  assert.equal(wallClock(summer, 'Australia/Brisbane').hour, 9); // AEST +10, no DST
  assert.deepEqual(
    [wallClock(summer, 'Australia/Adelaide').hour, wallClock(summer, 'Australia/Adelaide').minute],
    [10, 0], // ACDT +10:30
  );
  assert.equal(wallClock(summer, 'Australia/Perth').hour, 7); // AWST +8
  const winter = new Date(Date.UTC(2025, 6, 1, 0, 0, 0));
  assert.equal(wallClock(winter, 'Australia/Sydney').hour, 10); // AEST +10
  assert.equal(wallClock(summer, 'UTC').weekday, 6); // still Sunday
});

test('South African time packets match the previous fixed UTC+2 encoding', () => {
  const now = new Date(Date.UTC(2026, 10, 16, 22, 59, 58));
  const local = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const legacy = [
    local.getUTCSeconds(),
    local.getUTCMinutes(),
    local.getUTCHours(),
    (local.getUTCDay() + 6) % 7,
    local.getUTCDate(),
    local.getUTCMonth(),
    local.getUTCFullYear() - 2000,
    0,
  ];
  const key = Buffer.from('38983fba4dbfab9c', 'hex');
  for (const [i, byte] of [0xaa, 0xbb, 0xcc, 0xdd].entries()) key[i]! ^= byte;
  const packet = timePacket(mac, 'Africa/Johannesburg', now);
  assert.deepEqual([...packet.subarray(0, 4)], [1, 1, 5, 0]);
  assert.deepEqual(
    [...packet.subarray(4)].map((v, i) => v ^ key[i]!),
    legacy,
  );
});

test('controller time zone prefers config, then a non-UTC host, then the datacentre', () => {
  assert.equal(controllerTimeZone('au', 'Australia/Perth', 'Europe/London'), 'Australia/Perth');
  assert.equal(controllerTimeZone('au', undefined, 'Pacific/Auckland'), 'Pacific/Auckland');
  assert.equal(controllerTimeZone('za', undefined, 'Africa/Windhoek'), 'Africa/Windhoek');
  for (const host of ['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Etc/Universal']) {
    assert.equal(controllerTimeZone('za', undefined, host), 'Africa/Johannesburg');
    assert.equal(controllerTimeZone('au', undefined, host), 'Australia/Sydney');
  }
  assert.equal(controllerTimeZone('au', 'Not/AZone', 'UTC'), 'Australia/Sydney');
  assert.equal(isTimeZone('Australia/Darwin'), true);
  assert.equal(isTimeZone('Mars/Olympus'), false);
});
