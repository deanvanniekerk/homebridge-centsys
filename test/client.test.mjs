import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { CentsysReadClient } from "../dist/client.js";
import { CentsysError } from "../dist/errors.js";
import {
  decodeDevices,
  decodeOverviews,
  normalizeNumber,
} from "../dist/protocol.js";
import { diagnosticReport } from "../dist/diagnostics.js";

const number = "+27820000000";
const bootstrapToken = "fixture-bootstrap";
const sessionToken = "fixture-session";
const secretSerial = "fixture-private-serial";
const device = {
  serialNumber: secretSerial,
  productCode: 32,
  productType: 50,
  isWifiDevice: true,
  deviceWiFiStatus: { isOnline: true },
};
const status = {
  operatorSerialNumber: secretSerial,
  operatorStatus: 2,
  closingBeamStatus: 0,
};
const expectCode = (code) => (error) =>
  error instanceof CentsysError && error.code === code;

async function service(t, handler, options = {}) {
  const calls = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const call = {
      method: request.method,
      path: request.url,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(call);
    handler(call, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const client = new CentsysReadClient({
    mobileNumber: number,
    region: "za",
    bootstrapToken,
    fetch: async (url, init) => {
      assert.equal(
        url.origin,
        "https://centsys.southafricanorth.cloudapp.azure.com:4445",
      );
      return fetch(
        `http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`,
        init,
      );
    },
    ...options,
  });
  return { client, calls, server };
}

function json(response, value) {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(value));
}

test("OTP login, account discovery and overview use the observed wire contract", async (t) => {
  const { client, calls } = await service(t, (call, response) => {
    if (call.path === "/SendOtp") return json(response, true);
    if (call.path === "/ValidateOtp")
      return json(response, { response: sessionToken });
    if (call.path.startsWith("/GetDevices")) return json(response, [device]);
    return json(response, [status]);
  });
  await client.sendOtp("sms");
  assert.equal(await client.validateOtp("012345"), sessionToken);
  const devices = await client.discover();
  const overviews = await client.overview(devices);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST", "POST", "POST", "POST"],
  );
  assert.deepEqual(calls[0].body, {
    MobileNumber: number,
    OtpPlatform: 2,
    ThreeLetterIsoLanguageName: "eng",
  });
  assert.deepEqual(calls[1].body, { MobileNumber: number, Otp: "012345" });
  assert.equal(
    new URL(calls[2].path, "https://test.invalid").searchParams.get(
      "remoteUserNumber",
    ),
    number,
  );
  assert.match(calls[2].path, /%2B/);
  assert.equal(calls[2].body, undefined);
  assert.deepEqual(calls[3].body, { OperatorSerialNumbers: [secretSerial] });
  assert.deepEqual(
    calls.map((call) => call.headers.authorization),
    [
      `Bearer ${bootstrapToken}`,
      `Bearer ${bootstrapToken}`,
      `Bearer ${sessionToken}`,
      `Bearer ${sessionToken}`,
    ],
  );
  assert.equal(overviews[0].state, "closed");
  assert.equal(overviews[0].closingBeamCode, 0);
  assert.equal(overviews[0].openingBeamCode, null);
});

test("WhatsApp selector sends channel 1, exactly once", async (t) => {
  const { client, calls } = await service(t, (_call, response) =>
    json(response, true),
  );
  await client.sendOtp("whatsapp");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.OtpPlatform, 1);
});

test("OTP false or empty validation is rejected and does not authenticate", async (t) => {
  const { client, calls } = await service(t, (call, response) =>
    json(response, call.path === "/SendOtp" ? false : { response: "" }),
  );
  await assert.rejects(client.sendOtp("sms"), expectCode("otp-not-sent"));
  await assert.rejects(client.validateOtp("12345"), expectCode("otp-rejected"));
  await assert.rejects(client.discover(), expectCode("authentication"));
  assert.equal(calls.length, 2);
});

test("non-string and invalid validation tokens are protocol errors", async (t) => {
  for (const value of [null, true, {}, "line\nbreak"]) {
    await t.test(JSON.stringify(value), async (t) => {
      const { client } = await service(t, (_call, response) =>
        json(response, { response: value }),
      );
      await assert.rejects(client.validateOtp("12345"), expectCode("protocol"));
    });
  }
});

test("empty discovery is valid; a malformed envelope is never reported as no devices", async (t) => {
  const { client, calls } = await service(
    t,
    (_call, response) =>
      json(response, calls.length === 1 ? [] : { response: [] }),
    { sessionToken },
  );
  assert.deepEqual(await client.discover(), []);
  assert.deepEqual(await client.overview([]), []);
  assert.equal(calls.length, 1);
  await assert.rejects(client.discover(), expectCode("protocol"));
});

test("all HTTPS states decode independently of MQTT and unknown codes remain unknown", () => {
  const requested = new Set([secretSerial]);
  const labels = [
    "unknown",
    "open",
    "closed",
    "partly-open",
    "partly-closed",
    "opening",
    "closing",
  ];
  for (const [code, label] of labels.entries())
    assert.equal(
      decodeOverviews([{ ...status, operatorStatus: code }], requested)[0]
        .state,
      label,
    );
  for (const code of [null, undefined, -1, 99])
    assert.equal(
      decodeOverviews([{ ...status, operatorStatus: code }], requested)[0]
        .state,
      "unknown",
    );
  for (const code of ["2", true, 1.5])
    assert.throws(
      () => decodeOverviews([{ ...status, operatorStatus: code }], requested),
      expectCode("protocol"),
    );
});

test("ambiguous identities and malformed telemetry fail closed; missing rows remain missing", () => {
  for (const rows of [
    [device, device],
    [{}],
    [null],
    [[], device],
    [{ ...device, serialNumber: "" }],
    [{ ...device, isWifiDevice: "false" }],
    [{ ...device, deviceWiFiStatus: { isOnline: "false" } }],
  ]) {
    assert.throws(() => decodeDevices(rows), expectCode("protocol"));
  }
  const requested = new Set([secretSerial]);
  assert.throws(
    () => decodeOverviews([status, status], requested),
    expectCode("protocol"),
  );
  assert.throws(
    () =>
      decodeOverviews(
        [{ ...status, operatorSerialNumber: "another-device" }],
        requested,
      ),
    expectCode("protocol"),
  );
  assert.deepEqual(decodeOverviews([], requested), []);
  assert.equal(decodeDevices([{ serialNumber: secretSerial }])[0].online, null);
});

test("HTTP failures are bounded, not retried, and never include sensitive response text", async (t) => {
  for (const [httpStatus, code] of [
    [401, "authentication"],
    [403, "authentication"],
    [429, "rate-limited"],
    [500, "http"],
  ]) {
    await t.test(String(httpStatus), async (t) => {
      const { client, calls } = await service(
        t,
        (_call, response) => {
          response.writeHead(httpStatus);
          response.end(`secret ${number} ${sessionToken}`);
        },
        { sessionToken },
      );
      await assert.rejects(client.discover(), (error) => {
        assert.ok(expectCode(code)(error));
        assert.doesNotMatch(
          JSON.stringify(error) + error.stack,
          /fixture-session|27820000000/,
        );
        return true;
      });
      assert.equal(calls.length, 1);
    });
  }
});

test("redirects cannot forward authentication to another endpoint", async (t) => {
  const { client, calls } = await service(
    t,
    (_call, response) => {
      response.writeHead(302, { Location: "/credential-leak" });
      response.end();
    },
    { sessionToken },
  );
  await assert.rejects(client.discover(), expectCode("transport"));
  assert.equal(calls.length, 1);
});

test("deadline covers a stalled response body and never retries", async (t) => {
  const { client, calls } = await service(
    t,
    (_call, response) => {
      response.writeHead(200);
      response.write("[");
    },
    { sessionToken, timeoutMs: 100 },
  );
  await assert.rejects(client.discover(), expectCode("timeout"));
  assert.equal(calls.length, 1);
});

test("cancellation prevents a request and interrupts an in-flight request", async (t) => {
  const { client, calls, server } = await service(
    t,
    (_call, response) => {
      response.writeHead(200);
      response.write("[");
    },
    { sessionToken },
  );
  const already = AbortSignal.abort();
  await assert.rejects(client.discover(already), expectCode("cancelled"));
  assert.equal(calls.length, 0);
  const controller = new AbortController();
  const received = once(server, "request");
  const pending = client.discover(controller.signal);
  await received;
  controller.abort();
  await assert.rejects(pending, expectCode("cancelled"));
});

test("invalid JSON and oversized response bodies are rejected", async (t) => {
  for (const body of ["not JSON", " ".repeat(1_048_577)]) {
    await t.test(String(body.length), async (t) => {
      const { client } = await service(
        t,
        (_call, response) => response.end(body),
        { sessionToken },
      );
      await assert.rejects(client.discover(), expectCode("protocol"));
    });
  }
});

test("input validation rejects ambiguous phone numbers and unknown regions before network access", () => {
  assert.equal(normalizeNumber("00 27 (82) 000-0000"), number);
  for (const input of [
    "0820000000",
    "+27not-a-number",
    "+27+820000000",
    "+0123456789",
  ])
    assert.throws(() => normalizeNumber(input), expectCode("configuration"));
  assert.throws(
    () => new CentsysReadClient({ mobileNumber: number, region: "unknown" }),
    expectCode("configuration"),
  );
});

test("diagnostics keep unknown/offline context and discard all private metadata", () => {
  const devices = decodeDevices([
    {
      ...device,
      deviceName: "PRIVATE-NAME",
      macAddress: "PRIVATE-MAC",
      lattitude: "PRIVATE-LOCATION",
      deviceWiFiStatus: { isOnline: false },
    },
  ]);
  const overviews = decodeOverviews([status], new Set([secretSerial]));
  const report = diagnosticReport(
    devices,
    overviews,
    new Date("2026-09-09T00:00:00Z"),
  );
  assert.equal(report.deviceMeasurementTimeKnown, false);
  assert.equal(report.devices[0].onlineAtDiscovery, false);
  assert.equal(report.devices[0].cloudReportedState, "closed");
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|fixture-private-serial/);
  const missing = diagnosticReport(devices, [], new Date());
  assert.equal(missing.devices[0].cloudReportedState, "unknown");
  assert.equal(missing.devices[0].overviewReceived, false);
});

test("MQTT certificate retrieval uses saved bearer and rejects malformed secrets without exposing them", async (t) => {
  let result = {
    CertificatePfxBase64: Buffer.from("synthetic-pfx").toString("base64"),
    CertificatePassword: "synthetic-passphrase",
  };
  const { client, calls } = await service(
    t,
    (_call, response) => json(response, result),
    { sessionToken },
  );
  const certificate = await client.certificate();
  assert.equal(certificate.pfx.toString(), "synthetic-pfx");
  assert.equal(certificate.password, "synthetic-passphrase");
  assert.equal(calls[0].path, "/GetCertificate");
  assert.deepEqual(calls[0].body, {});
  assert.equal(calls[0].headers.authorization, `Bearer ${sessionToken}`);
  result = {
    certificatePfxBase64: "malformed-private-certificate",
    certificatePassword: { secret: "private" },
  };
  await assert.rejects(
    client.certificate(),
    (e) => e.code === "protocol" && !e.message.includes("private"),
  );
});
