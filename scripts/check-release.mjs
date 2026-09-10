import { readFileSync } from "node:fs";

const metadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const approved = process.env.CENTSYS_RELEASE_APPROVED;
const version =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta)\.(0|[1-9]\d*))?$/.exec(
    metadata.version,
  );
if (!version) {
  throw new Error(
    "Release version must be X.Y.Z, X.Y.Z-alpha.N or X.Y.Z-beta.N.",
  );
}
if (approved !== metadata.version) {
  throw new Error(
    "Publication requires a separate release decision: approve the exact package version.",
  );
}
const tag = version[5] ?? "latest";
if (
  metadata.private ||
  metadata.publishConfig?.access !== "public" ||
  metadata.publishConfig?.tag !== tag ||
  metadata.publishConfig?.registry !== "https://registry.npmjs.org/"
) {
  throw new Error(
    "Release metadata must select public npm access and the matching dist-tag.",
  );
}
console.log(
  `Release guard passed for ${metadata.name}@${metadata.version} (${tag})`,
);
