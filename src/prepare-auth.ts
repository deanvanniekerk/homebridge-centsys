import { createHash } from "node:crypto";
import { CentsysError } from "./errors.js";
import { credential } from "./protocol.js";
import { writePrivate } from "./storage.js";

// Source-pinned, opt-in setup step. Downloads data only; never executes Python.
const revision = "4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba";
const sourceUrl = `https://api.github.com/repos/Lex-campbell/centsys_remote/contents/custom_components/centsys_remote/api/const.py?ref=${revision}`;
const expectedHash =
  "a812a8a58d1b1359396ccfe1f605885420465ed5bb820279c4aacc2ee40cc5f1";

try {
  const response = await fetch(sourceUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "homebridge-centsys/0.0.0",
    },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new CentsysError("http");
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 65_536) throw new CentsysError("protocol");
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks);
  if (createHash("sha256").update(source).digest("hex") !== expectedHash)
    throw new CentsysError("protocol");
  const block = /GATEWAY_API_SERVICE_LEVEL_JWT\s*=\s*\(([\s\S]*?)\)/.exec(
    source.toString("utf8"),
  )?.[1];
  if (!block) throw new CentsysError("protocol");
  const token = credential(
    [...block.matchAll(/"([A-Za-z0-9_.-]+)"/g)]
      .map((match) => match[1])
      .join(""),
  );
  await writePrivate("bootstrap-token", `${token}\n`);
  process.stdout.write(
    "Pinned bootstrap credential saved privately under .local/auth/. No CENTSYS account request was sent.\n",
  );
} catch (error) {
  const safe =
    error instanceof CentsysError ? error : new CentsysError("transport");
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = 1;
}
