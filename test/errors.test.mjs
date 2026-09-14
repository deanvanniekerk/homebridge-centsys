import test from "node:test";
import assert from "node:assert/strict";
import { CentsysError, formatError } from "../dist/errors.js";
import { parseConfig } from "../dist/settings.js";

test("diagnostic formatting rejects arbitrary text, unknown keys and invalid numeric metadata", () => {
  const error = new CentsysError("protocol", {
    operation: "GetOperatorOverview",
    reason: "expected-integer",
    field: "operatorStatus",
    stage: "private-token\nforged log",
    bytes: "private-bytes",
    status: Infinity,
    body: "private-body",
    cause: new Error("private-cause"),
  });
  error.message = "private-error-message";
  assert.equal(
    formatError(error),
    "The service response did not match the expected protocol. [operation=GetOperatorOverview, reason=expected-integer, field=operatorStatus]",
  );
  for (const bytes of [-1, 1.5, NaN, 268435456])
    assert.equal(
      new CentsysError("protocol", { bytes }).diagnostic.bytes,
      undefined,
    );
  assert.equal(Object.isFrozen(error.diagnostic), true);
});

test("diagnostic logging is explicitly opt-in and rejects non-boolean configuration", () => {
  assert.equal(parseConfig({}).diagnosticLogging, false);
  assert.equal(
    parseConfig({ diagnosticLogging: false }).diagnosticLogging,
    false,
  );
  assert.equal(
    parseConfig({ diagnosticLogging: true }).diagnosticLogging,
    true,
  );
  for (const diagnosticLogging of ["true", "false", 1, null, {}])
    assert.throws(
      () => parseConfig({ diagnosticLogging }),
      (e) => e.code === "configuration",
    );
});
