# Implementation and validation status

## Implemented

- TypeScript client for SendOtp, ValidateOtp, GetDevicesByRemoteUserNumber and GetOperatorOverview.
- Explicit OTP login, private session persistence, sanitized single-shot status diagnostics and local logout.
- Source-pinned local bootstrap preparation with SHA-256 verification.
- Strict discovery/overview parsing, no command API, bounded HTTP requests, cancellation and no redirects/retries.
- CI checks on Node 22 and 24, with no account credentials or hardware access.

## Evidence

The owner validated remote actuation and Closed/Opening/Open/Closing feedback using the official MyCentsys Remote app outside nearby Bluetooth range. This establishes a practical cloud route but does not validate this implementation.

Local tests exercise real loopback HTTP requests through an injected fetch transport: request paths, phone query encoding, both OTP channels, bearer transition, rejection paths, empty versus malformed discovery, state mappings, duplicate/unexpected identities, fixed error messages, redirect rejection, body limits, timeout and cancellation. Storage tests check permissions, replacement, malformed credentials, symlink handling and local logout. Diagnostic tests verify that identifying fields never enter reports.

### Live account check — 9 September 2026

- Source-pinned bootstrap preparation completed with the expected SHA-256.
- WhatsApp SendOtp was accepted; the owner supplied the received code; ValidateOtp returned a session. The backend accepted this client's own User-Agent for these operations.
- GetDevicesByRemoteUserNumber returned HTTP 200 with an empty array. The sanitized report received at 14:03:48 UTC contained `devices: []`.
- GetOperatorOverview was deliberately skipped because discovery supplied no operator identities. Gate state, product type/code and firmware have not been read by this client.
- Additional one-off, read-only probes of the pinned upstream's discovery alternatives found no app backup (GetLatestRemotesAppBackup: HTTP 404) and no shared sites (GetAccessesByUserNumber: HTTP 200, `sharedAccesses: []`). These probes are investigation results, not supported CLI discovery paths.

This reproduces the absence of cloud discovery seen during SMART Plus Retrieval. It does not disprove the owner's successful official-app control or identify why cloud linkage is missing. Check the actual controller identity and cloud Remote-user linkage before changing account records. Do not repeatedly delete working app entries or guess serial numbers.

Credentials remain in ignored, owner-only local storage. No gate commands were sent. Test fixtures remain synthetic and based on community source, not captures of gate telemetry. Later screenshot evidence establishes the model and firmware, as recorded below.

### Controller identity and direct overview — 9 September 2026, 16:12 SAST

New Pro screenshots identify **D5 Evo SMART+**, with **Core 2.1.0.0** and **Comms Interface 2.1.0.0**. The displayed Pro account number matches the authenticated account. Wi-Fi remains enabled, signal Excellent, Connected to Cloud Yes, and power saving off. The app update screen considers Pro 1.5.0.213 current; its separately displayed latest-version field is 1.5.0.207, so this screen is not evidence that controller firmware is current.

**Correction:** this first one-off GetOperatorOverview call accidentally used a 25-character transcription containing an extra digit, not the exact serial in Operator Information. The existing client accepted the response as an empty overview list at 14:12:05 UTC. No current gate state or numeric product code/type was returned. The serial is held in ignored, owner-only `.local/auth/operator.json`; no identifying screenshot or serial is included in the public repo. The later corrected probe and manual-device CLI mode supersede this result.

The earlier conclusion that knowing the serial did not yield an overview was invalid because the transcription was wrong. Possible account/controller synchronization or protocol differences remain hypotheses, not diagnoses. The Force Sync option is visible in Pro and described there as syncing all settings, but its direction and effect on cloud registration have not been verified. A user-run sync followed by the same read-only requests is a proposed experiment; no sync, restart, user edit or gate command was performed by the agent.

### Post-reset check and corrected identity — 9 September 2026, 16:16–16:22 SAST

The owner reported “reset done” after the Force Sync suggestion; whether this meant Force Sync, Restart Operator or both was requested for clarification. The post-reset account discovery still returned an empty list. Its query uses the account number, so it was unaffected by the serial transcription mistake.

The manually transcribed serial was found to contain 25 hex characters. macOS Vision recognition of the original screenshot recovered a single 24-character value, differing by one extra character in the original transcription. The local identity was corrected. The 16:12 and 16:16 direct-overview results and the first MQTT subscription/request probes used the wrong serial and are not valid tests of this gate.

With the corrected identity, GetOperatorOverview returned a matching row at **14:19:25 UTC**: state code **2 (Closed)**, power code 0, both beam codes 0 and theft-alarm code 2. These non-state codes remain uninterpreted. This is the first successful third-party cloud status read; it is not yet a comparison against observed movement or a freshness guarantee. Discovery is still empty, but no longer prevents a manually configured status request.

One-off MQTT probes obtained a client certificate, completed mutually authenticated TLS 1.2 with the pinned CA and server-name verification, connected using MQTT v5, and obtained broker subscription acknowledgements. Using the corrected serial, the operator returned a connectionRequestResponse. An identity-only packet (command 01, generated by the pinned reference codec from the account number and the screenshot Wi-Fi MAC) was subsequently sent once after a response. No identity response or telemetry was observed during that 18-second session. The Wi-Fi MAC has not been independently validated as the identity codec key. No time-sync, activation packet or gate control command was sent. Broker connectivity and an operator connection response do not prove the identity handshake or live telemetry works.

The production diagnostic CLI now supports `status-known` using private `operator.json`, with exact 24-hex-character validation for this manual SMART+ path. It reports identity source explicitly, preserves unknown discovery metadata, and keeps the ordinary discovery command separate. The MQTT probes remain local experiments; no production MQTT transport is included yet.

### Observed HTTPS state cycle — 10 September 2026

The existing saved session authenticated successfully the following morning. With the corrected manual identity, the agent sampled GetOperatorOverview at a nominal two-second interval for a bounded two-minute window while the owner opened the gate through the official app, paused at fully open, and closed it. Each request completed before the interval delay began, so the actual sample spacing includes HTTP request time. No agent gate commands were sent.

| First received (SAST, UTC+02:00) | Cloud state | HTTPS code |
| --- | --- | --- |
| 10:28:22.941 | Closed | 2 |
| 10:28:51.745 | Opening | 5 |
| 10:29:02.839 | Open | 1 |
| 10:29:18.353 | Closing | 6 |
| 10:29:29.505 | Closed | 2 |

The owner confirmed “no delay, open closed as normal.” This confirms normal physical operation during the test and the absence of a noticeable app-control delay. It does not measure API latency: physical transition times were not independently timestamped. The table records first receipt by our client, not motor event timestamps or precise travel durations.

This demonstrates that HTTPS overview can deliver both moving and endpoint states on this installation. It does not establish a vendor-supported permanent two-second polling rate, immunity to stale backend caches, loss-of-connectivity behavior, or an acceptable control precondition. Keep command handling dependent on independently validated freshness and operating semantics. A low-rate idle poll plus bounded faster observation around activity is a candidate design, not an implemented or validated policy.

A sanitized capture summary is stored in [the state-cycle evidence file](validation/2026-09-10-http-state-cycle.json). Raw local samples contain only request/receipt timestamps, state codes and row presence, and remain under ignored `.local/`.

## Remaining before Homebridge control

Investigate empty discovery while using the confirmed manual identity; extend the successful HTTP cycle test to establish timing and stale/offline behavior; implement MQTT certificate handling and telemetry; validate family-specific activation semantics and target-state reconciliation; then build and test the Homebridge accessory and iHost deployment. No npm release or Homebridge compatibility claim is made by this checkpoint.
