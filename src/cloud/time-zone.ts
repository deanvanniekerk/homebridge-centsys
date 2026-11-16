import type { Region } from './cloud-protocol.js';
import { datacentres } from './datacentre.js';

const utcAliases = /^(Etc\/)?(UTC|UCT|GMT([+-]?0)?|Universal|Zulu|Greenwich)$/i;

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function hostTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The controller expects its local wall-clock time. Prefer an explicit setting, then the host.
 * Containers commonly default to UTC, which is rarely where the gate is, so UTC falls back to
 * the datacentre's main time zone. Set `timeZone` (or the host's TZ) when that is wrong.
 */
export function controllerTimeZone(
  region: Region,
  configured?: string,
  host: string | undefined = hostTimeZone(),
): string {
  if (configured && isTimeZone(configured)) return configured;
  if (host && !utcAliases.test(host) && isTimeZone(host)) return host;
  return datacentres[region].fallbackTimeZone;
}

export interface WallClock {
  second: number;
  minute: number;
  hour: number;
  /** Monday = 0 … Sunday = 6. */
  weekday: number;
  day: number;
  /** January = 0. */
  month: number;
  year: number;
}

export function wallClock(now: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  const weekday = (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7;
  return {
    second: parts.second,
    minute: parts.minute,
    hour: parts.hour,
    weekday,
    day: parts.day,
    month: parts.month - 1,
    year: parts.year,
  };
}
