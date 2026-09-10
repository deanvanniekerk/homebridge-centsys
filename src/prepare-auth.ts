import { fetchBootstrap } from "./bootstrap.js";
import { writePrivate } from "./storage.js";
import { CentsysError } from "./errors.js";
try {
  await writePrivate("bootstrap-token", `${await fetchBootstrap()}\n`);
  process.stdout.write(
    "Pinned bootstrap credential saved privately under .local/auth/. No CENTSYS account request was sent.\n",
  );
} catch (error) {
  const safe =
    error instanceof CentsysError ? error : new CentsysError("transport");
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = 1;
}
