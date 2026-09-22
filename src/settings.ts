import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLUGIN_NAME = 'homebridge-centsys';
export const PLATFORM_NAME = 'Centsys';
export const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
export const storageDirectory = (root: string) => join(root, 'centsys', 'auth');
