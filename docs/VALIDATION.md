# Implementation and validation status

## Implemented

- TypeScript client for SendOtp, ValidateOtp, GetDevicesByRemoteUserNumber and GetOperatorOverview.
- Explicit OTP login, private session persistence, sanitized single-shot status diagnostics and local logout.
- Source-pinned local bootstrap preparation with SHA-256 verification.
- Strict discovery/overview parsing, bounded HTTP requests, cancellation and no redirects/retries.
- Homebridge settings UI with explicit OTP login, private persistent sessions, discovery and manual gate setup.
- GarageDoorOpener accessory, unavailable-state handling, bounded polling and experimental opt-in MQTT control for the tested D5 Evo SMART+ family in ZA.
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

### Homebridge alpha and corrected MQTT handshake — 10 September 2026

The earlier identity probe supplied the wrong MQTT ResponseTopic. Using `userRemoteTriggerResponse` for command 01 produced a 12-byte command-02 challenge and a 68-byte deviceOverview message. The production TypeScript session then independently returned Closed and 13.4 V with `activated: false`. The decoded beam status was unknown because the installation's beams are disabled. TLS certificate and server-name verification remained enabled. No time-sync or activation packet was sent during these read-only checks.

The alpha implements custom Homebridge UI authentication, private session storage, manual/discovered gate configuration, HTTPS monitoring and an optional MQTT command path. The UI requests an OTP only on an explicit button press; invalid codes preserve an existing saved session. Automatic token renewal has not been established; a rejected session requires the owner to sign in again.

All 43 local tests pass on Node 24.15.0. Automated tests cover the real Homebridge HAP characteristic objects, UI-server IPC, OTP expiry/attempt limits, private storage, HTTP wire contracts, synthetic MQTT exchanges, missing/stale state, concurrent commands and late HTTP responses. The browser preview uses a synthetic Homebridge API and exercised login, empty discovery, manual status check and saving a gate. A clean production-only installation of the generated tarball also loaded the plugin registration, bundled CA and UI IPC server successfully. These checks do not constitute a deployment on iHost or a live OTP test through the finished UI.

MQTT activation uses a fresh session, decoded gate telemetry, an explicit supported-family/TRG-mode opt-in and a single QoS-0 command. The complete Homebridge command attempt has an eight-second budget. Ambiguous outcomes are not replayed. Automatic actuation is disabled by default. Time sync, command acceptance and actual movement through this code remain unverified on hardware.

### iHost installation and Apple Home availability — 10 September 2026

- Installed alpha.0 from a SHA-256-verified development tarball on Ubuntu 24.04.1 ARM32, Node 22.23.2 and Homebridge 2.4.0. A full Homebridge backup was created first.
- Completed WhatsApp OTP login through the real Homebridge custom UI. A manual identity status check returned Closed, and the configuration was saved with control disabled. Credentials remain in persistent private storage, outside the configuration and repository.
- A dedicated CENTSYS child bridge started after the initial Homebridge restart. AquaTemp, Midea and Sunsynk retained their installed versions and all bridges showed Running.
- The owner paired the bridge and reported **No Response** in Apple Home. At the same time, Homebridge’s Accessories page showed **Home Gate: Closed**.
- A regression using real HAP characteristics reproduced status `-70402` (communication failure) on ObstructionDetected while CurrentDoorState and TargetDoorState both read Closed. The old mapping treated missing obstruction telemetry as transport failure.
- Alpha.1 reports detected obstruction as a Boolean while retaining nullable telemetry internally. Its regression passes with a readable gate and missing beam feedback; stale gate data still makes all three required state characteristics unavailable. Command checks and the control-disabled configuration are unchanged. Installed alpha.1 on iHost and restarted only the CENTSYS child bridge. Apple Home then showed **Home Gate — Closed**, verified directly in the macOS Home app. The saved login survived the update/restart. On-host metadata confirmed auth directory mode 0700 and credential files 0600. All 43 local tests passed before deployment.

No agent gate activation has been sent. Device identities, account details, pairing credentials and private backups are excluded from this report.

### First HomeKit command and delayed telemetry — 10 September 2026

The owner confirmed readiness at the gate. Control was explicitly enabled with the supported family, Wi-Fi identity and confirmed TRG endpoint behavior. One open request was made in Apple Home. Home briefly displayed Opening (its request presentation), then returned to Closed; the owner confirmed no physical movement. The runtime reported cancellation at its eight-second deadline. The failure was before the activation publish, so the plugin did not replay it and no close request was sent.

A read-only diagnostic using the installed session on iHost completed certificate retrieval at 0.871 seconds, connected to MQTT at 1.569 seconds, and received the identity challenge at 1.893 seconds. The first 68-byte deviceOverview arrived at 13.866 seconds; the session returned Closed and `activated: false`. These are elapsed receive times for a single probe, not a guaranteed cadence. This isolates a delay that can exceed the original command budget without an authentication failure.

Alpha.2 acknowledges accepted HomeKit commands promptly and runs one bounded command job. It keeps a 30-second overall deadline, the existing 25-second MQTT limit, fresh-state requirements and no activation retries. Current state remains observed; a requested target is stored separately. Tests reproduce the old blocking HAP write and verify prompt acknowledgement, later failure reporting, busy rejection, deadline cancellation and shutdown. All 45 tests passed, and alpha.2 was installed from a checksum-verified tarball on iHost with a CENTSYS-only child bridge restart. Physical actuation through the revised path remains pending.

### Time-reply envelope correction — 10 September 2026

The owner confirmed readiness for a second HomeKit open request on alpha.2. It also timed out before activation; the owner confirmed no movement, and Home returned to Closed. No close request or automatic activation retry was sent.

A diagnostic with activation explicitly blocked traced the installed client through identity, telemetry and time sync. It received a 68-byte overview at 13.815 seconds, sent command 05 at 13.822 seconds, and received an eight-byte command-06 reply at 13.911 seconds. The session nevertheless timed out. A header-only follow-up identified the reply envelope as `01 01 06 20`; the parser required byte 3 to be zero. The meaning of that header byte is not independently established. No account identifier, challenge, certificate or payload body is included in these notes.

Alpha.3 recognizes this exact eight-byte command-06 envelope in addition to the existing zero-byte variant. Identity and activation response parsing remain unchanged, as do the fresh-state check, account recheck and single-publish rule. Synthetic tests reproduce the rejected envelope and verify that different flags or lengths cannot advance to activation. All 46 tests passed. A checksum-verified alpha.3 tarball was installed on iHost. A probe using that installed code received telemetry at 13.904 seconds and command 06 at 14.051 seconds, then reached the final pre-activation callback at 14.053 seconds. The callback deliberately stopped the session; a second publish guard independently blocked command 03. The probe completed with `activated: false`. Only the CENTSYS child bridge was restarted, its log confirmed alpha.3, and Apple Home remained Closed. This verifies progress through the handshake, not command acceptance or physical movement; those still require an owner-observed test.

### First activation response — 10 September 2026

Following renewed owner readiness, one Apple Home open request was sent on alpha.3. The runtime reported `command-rejected` at 10:07:49 UTC, and Apple Home returned to Closed. Unlike the first two attempts, this path reached the single activation publish and parsed a command-04 reply whose decoded response code was not success. No automatic retry or close request was sent. The owner confirmed no movement and that the gate remained closed.

The current Boolean response decoder discards the numeric rejection code and returned configuration version. The existing log therefore cannot distinguish a configuration mismatch from another rejection. The pinned reference decodes both fields and identifies code 7 as configuration mismatch, but this has not been established for this attempt. A source comparison confirmed that the pinned Home Assistant integration starts with configuration version 0 and permits at most one corrected-version resend, exclusively when reply code 7 supplies a different version. It stops on other rejection codes or missing replies. Our port currently hardcodes version 0 and omits this negotiation. A future supervised attempt needs narrowly scoped capture of those two decoded numeric fields; the current evidence does not justify changing the activation packet or adding retries.

### Configuration-version negotiation — alpha.4

The new regression first failed on the existing implementation with `command-rejected` for a synthetic code-7/version-9 reply. Alpha.4 preserves decoded response code and configuration version and exposes only those numeric fields plus attempt number in the Homebridge log. It permits one corrected-version publish after explicit code 7 with a different version. Before that publish it repeats account, cancellation, state-age and target/obstruction checks within the original deadline. No missing acknowledgement or other rejection causes a retry. Once the first request is explicitly rejected, cancellation before a corrected publish is no longer classified as an uncertain activation; a missing or malformed reply after a publish remains uncertain.

Protocol regressions cover negotiation success and packet contents, unchanged/different repeated mismatches, other rejections, malformed/missing replies, and changed authorization, cancellation, stale telemetry or target state before the retry. These are synthetic tests of the reference behavior, not evidence that this gate returned code 7. All 49 tests and formatting/build checks passed. Alpha.4 was installed on iHost from a SHA-256-verified tarball; npm changed one package. Physical validation of the negotiation remains pending.

### Alpha.4 observed activation — 10 September 2026

After owner readiness, one HomeKit open request reached the activation response at 10:23:42 UTC. The decoder logged `attempt=1, code=64, configVersion=110`. This does not match the explicit code-7 negotiation condition, so no corrected-version publish occurred. Apple Home returned to Closed, and the owner confirmed no movement. No close request was sent.

The numeric values are decoder output, not independently validated vendor meanings. The pinned reference defines success 1 and configuration mismatch 7; it does not identify code 64. An offline differential comparison of TypeScript identity, versioned TRG and activation-response decoding against the pinned Python module passed with synthetic inputs. This checks the port, not whether the configured key is correct for this controller. A fresh authenticated cloud discovery returned zero rows, so no cloud `macAddress` was available for comparison. The reference uses the device listing's `macAddress`; our manual configuration uses the Pro Wi-Fi screenshot's MAC. Equivalence remains unverified. Future investigation should obtain an independently confirmed operator key source or a private official-app protocol capture, rather than trying alternate keys or commands on the motor.

## Remaining before routine Homebridge control

Observe moving and endpoint status updates in Apple Home. Perform an owner-observed activation test, including command acknowledgement, then test offline/stale behavior and target reconciliation. Investigate empty account discovery separately; the working manual identity path avoids blocking setup. No npm release has been published.
