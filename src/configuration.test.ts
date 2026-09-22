import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseConfig } from './configuration.js';
import { test } from './test-compat.test-support.js';

test('diagnostic logging is explicitly opt-in and rejects non-boolean configuration', () => {
  assert.equal(parseConfig({}).diagnosticLogging, false);
  assert.equal(parseConfig({ diagnosticLogging: false }).diagnosticLogging, false);
  assert.equal(parseConfig({ diagnosticLogging: true }).diagnosticLogging, true);
  for (const diagnosticLogging of ['true', 'false', 1, null, {}])
    assert.throws(
      () => parseConfig({ diagnosticLogging }),
      (e) => e.code === 'configuration',
    );
});

test('runtime gate validation preserves saved control-off and accepts only the supported enabled profile', () => {
  assert.deepEqual(parseConfig({ gates: null }).gates, []);
  const serialNumber = '00112233445566778899aabb';
  const macAddress = 'aa:bb:cc:dd:ee:ff';
  const saved = parseConfig({ gates: [{ serialNumber, macAddress }] });
  assert.deepEqual(saved.gates[0], {
    name: 'Gate',
    serialNumber: serialNumber.toUpperCase(),
    macAddress: macAddress.toUpperCase(),
    enableControl: false,
  });
  const enabled = parseConfig({
    gates: [{ serialNumber, macAddress, enableControl: true, controlProfile: 'd5-evo-smart-plus' }],
  });
  assert.equal(enabled.gates[0].enableControl, true);
  for (const gate of [
    { serialNumber, enableControl: true, controlProfile: 'd5-evo-smart-plus' },
    { serialNumber, macAddress, enableControl: true },
    { serialNumber, macAddress, enableControl: true, controlProfile: 'unknown' },
  ]) {
    assert.throws(
      () => parseConfig({ gates: [gate] }),
      (error) => error.code === 'configuration',
    );
  }
  assert.throws(
    () => parseConfig({ gates: [{ serialNumber }, { serialNumber: serialNumber.toUpperCase() }] }),
    (error) => error.code === 'configuration',
  );
});

test('Homebridge schema and runtime share bounds while the wizard controls new-gate defaults', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../config.schema.json', import.meta.url), 'utf8'),
  );
  const properties = schema.schema.properties;
  assert.equal(properties.pollInterval.minimum, 10);
  assert.equal(properties.pollInterval.maximum, 300);
  assert.equal(properties.gates.maxItems, 10);
  assert.equal(properties.gates.items.properties.name.maxLength, 64);
  assert.equal(properties.gates.items.properties.enableControl.default, true);
  assert.equal(
    parseConfig({ gates: [{ serialNumber: '00112233445566778899aabb' }] }).gates[0].enableControl,
    false,
  );
  for (const pollInterval of [9, 301, 15.5]) {
    assert.throws(
      () => parseConfig({ pollInterval }),
      (error) => error.code === 'configuration',
    );
  }
  assert.throws(
    () =>
      parseConfig({
        gates: Array.from({ length: 11 }, (_, index) => ({
          serialNumber: index.toString(16).padStart(24, '0'),
        })),
      }),
    (error) => error.code === 'configuration',
  );
});
