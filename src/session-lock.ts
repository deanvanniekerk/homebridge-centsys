import lockfile from "proper-lockfile";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { CentsysError } from "./errors.js";

/** Coordinate this installation's UI and child bridge; never wait/replay a command. */
export async function withSessionLock<T>(
  directory: string,
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const compromised = new AbortController();
  let release: (() => Promise<void>) | undefined;
  try {
    // The caller has already validated the private directory by reading its session.
    const root = await realpath(directory);
    release = await lockfile.lock(root, {
      lockfilePath: join(root, "mqtt-session.lock"),
      retries: 0,
      stale: 120_000,
      update: 10_000,
      onCompromised: () => compromised.abort(),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ELOCKED")
      throw new CentsysError("busy");
    throw new CentsysError("local-storage");
  }
  const combined = AbortSignal.any([signal, compromised.signal]);
  try {
    combined.throwIfAborted();
    const result = await run(combined);
    combined.throwIfAborted();
    return result;
  } finally {
    // gateSession settles only after bounded MQTT teardown.
    await release().catch(() => {});
  }
}
