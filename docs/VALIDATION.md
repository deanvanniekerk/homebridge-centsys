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

Credentials remain in ignored, owner-only local storage. No gate commands were sent. Test fixtures remain synthetic and based on community source, not captures of gate telemetry. The exact controller model and firmware remain unknown.

## Remaining before Homebridge control

Resolve empty discovery and prove an overview against the owner's gate; establish device identity and timing; implement MQTT certificate handling and telemetry; validate family-specific activation semantics and target-state reconciliation; then build and test the Homebridge accessory and iHost deployment. No npm release or Homebridge compatibility claim is made by this checkpoint.
