import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Region } from '../cloud/cloud-protocol.js';
import {
  credential,
  decodeDevices,
  normalizeNumber,
  regionSchema,
} from '../cloud/cloud-protocol.js';
import { CentsysError } from '../errors.js';
import type { Device } from '../gate/gate-model.js';

export const authDirectory = fileURLToPath(new URL('../../.local/auth/', import.meta.url));
export interface Session {
  mobileNumber: string;
  region: Region;
  token: string;
}

type PrivateFile = 'session.json' | 'bootstrap-token' | 'operator.json' | 'otp-attempt.json';
const operatorSchema = z.object({ serialNumber: z.string().regex(/^[0-9a-f]{24}$/i) });
const sessionSchema = z.object({
  version: z.literal(1),
  mobileNumber: z.string(),
  region: regionSchema,
  token: z.string(),
});

/** Explicit SMART+ identity from the owner's controller screen, never guessed. */
export async function readKnownOperator(directory = authDirectory): Promise<Device> {
  try {
    const value = operatorSchema.parse(JSON.parse(await readPrivate('operator.json', directory)));
    return decodeDevices([{ serialNumber: value.serialNumber.toUpperCase() }])[0]!;
  } catch {
    throw new CentsysError('local-storage');
  }
}

function decodeSession(value: unknown): Session {
  const result = sessionSchema.safeParse(value);
  if (!result.success) throw new CentsysError('local-storage');
  const row = result.data;
  return {
    mobileNumber: normalizeNumber(row.mobileNumber),
    region: row.region,
    token: credential(row.token),
  };
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new CentsysError('local-storage');
  await chmod(directory, 0o700);
}

export async function readPrivate(name: PrivateFile, directory = authDirectory): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CentsysError('local-storage');
    handle = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    const file = await handle.stat();
    if (
      !file.isFile() ||
      file.size > 65_536 ||
      (file.mode & 0o077) !== 0 ||
      (info.mode & 0o077) !== 0
    ) {
      throw new CentsysError('local-storage');
    }
    return await handle.readFile('utf8');
  } catch {
    throw new CentsysError('local-storage');
  } finally {
    await handle?.close();
  }
}

export async function writePrivate(
  name: PrivateFile,
  text: string,
  directory = authDirectory,
): Promise<void> {
  let temporary: string | undefined;
  try {
    await privateDirectory(directory);
    temporary = join(directory, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, join(directory, name));
  } catch {
    throw new CentsysError('local-storage');
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
}

export async function readSession(directory = authDirectory): Promise<Session> {
  try {
    return decodeSession(JSON.parse(await readPrivate('session.json', directory)));
  } catch {
    throw new CentsysError('local-storage');
  }
}

export async function saveSession(session: Session, directory = authDirectory): Promise<void> {
  const value = decodeSession({ version: 1, ...session });
  await writePrivate('session.json', `${JSON.stringify({ version: 1, ...value })}\n`, directory);
}

export async function forgetSession(directory = authDirectory): Promise<void> {
  try {
    await unlink(join(directory, 'session.json'));
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return;
    throw new CentsysError('local-storage');
  }
}

/** Absence is distinct from corrupt, insecure or unreadable credentials. */
export async function hasPrivate(name: PrivateFile, directory = authDirectory): Promise<boolean> {
  try {
    await lstat(join(directory, name));
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return false;
    throw new CentsysError('local-storage');
  }
}
