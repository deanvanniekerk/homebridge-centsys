import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { CentsysReadClient } from "./client.js";
import { CentsysError } from "./errors.js";
import { diagnosticReport } from "./diagnostics.js";
import { credential, normalizeNumber } from "./protocol.js";
import {
  forgetSession,
  readPrivate,
  readSession,
  saveSession,
} from "./storage.js";

const shutdown = new AbortController();
const abort = () => shutdown.abort();
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

async function login(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new CentsysError("configuration");
  const bootstrapToken = credential(
    (await readPrivate("bootstrap-token")).trim(),
  );
  // readline's terminal echo goes to this sink; secrets never reach output/history.
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const prompt = createInterface({
    input: process.stdin,
    output: sink,
    terminal: true,
    historySize: 0,
  });
  prompt.on("SIGINT", abort);
  async function ask(message: string): Promise<string> {
    process.stdout.write(message);
    const answer = await prompt.question("", { signal: shutdown.signal });
    process.stdout.write("\n");
    return answer.trim();
  }
  try {
    process.stdout.write(
      "Sign in to your own CENTSYS account. Input is hidden. No gate commands are available.\n",
    );
    const mobileNumber = normalizeNumber(
      await ask("Registered phone number, including +country code: "),
    );
    const regionInput = (await ask("Region [za/au, default za]: ")) || "za";
    if (regionInput !== "za" && regionInput !== "au")
      throw new CentsysError("configuration");
    const channel =
      (await ask("Send one OTP via [whatsapp/sms, default whatsapp]: ")) ||
      "whatsapp";
    if (channel !== "whatsapp" && channel !== "sms")
      throw new CentsysError("configuration");
    const client = new CentsysReadClient({
      mobileNumber,
      region: regionInput,
      bootstrapToken,
    });
    await client.sendOtp(channel, shutdown.signal);
    process.stdout.write(
      "The service accepted the OTP request. Delivery is not guaranteed.\n",
    );
    const token = await client.validateOtp(
      await ask("One-time code: "),
      shutdown.signal,
    );
    await saveSession({ mobileNumber, region: regionInput, token });
    process.stdout.write(
      "Signed in. Session saved privately under .local/auth/. Run: npm run diagnose -- status\n",
    );
  } finally {
    prompt.close();
    sink.destroy();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    process.stdout.write(
      "Read-only CENTSYS diagnostics\n\n  npm run prepare:auth          Fetch the pinned bootstrap credential locally\n  npm run diagnose -- login    Interactive phone/OTP sign-in (hidden input)\n  npm run diagnose -- status   Discover gates and print a sanitized cloud overview\n  npm run diagnose -- logout   Remove the local session (does not revoke it remotely)\n",
    );
    return;
  }
  if (args.length !== 1) throw new CentsysError("configuration");
  if (args[0] === "login") return login();
  if (args[0] === "logout") {
    await forgetSession();
    process.stdout.write("Local session removed.\n");
    return;
  }
  if (args[0] !== "status") throw new CentsysError("configuration");
  const session = await readSession();
  const client = new CentsysReadClient({
    mobileNumber: session.mobileNumber,
    region: session.region,
    sessionToken: session.token,
  });
  const devices = await client.discover(shutdown.signal);
  const overviews = await client.overview(devices, shutdown.signal);
  process.stdout.write(
    `${JSON.stringify(diagnosticReport(devices, overviews, new Date()), null, 2)}\n`,
  );
  if (devices.length === 0)
    process.stderr.write(
      "No linked operators were returned. This does not establish that the account has no locally paired devices.\n",
    );
}

try {
  await main();
} catch (error) {
  const safe = shutdown.signal.aborted
    ? new CentsysError("cancelled")
    : error instanceof CentsysError
      ? error
      : new CentsysError("local-storage");
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = shutdown.signal.aborted ? 130 : 1;
} finally {
  process.removeListener("SIGINT", abort);
  process.removeListener("SIGTERM", abort);
}
