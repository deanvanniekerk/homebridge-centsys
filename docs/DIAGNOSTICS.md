# Read-only cloud diagnostics

This is the first development slice of the Homebridge plugin, not an installable Homebridge accessory. It cannot trigger the gate, change controller configuration, enroll users or send MQTT activation packets. It performs HTTPS OTP authentication and reads the SMART Wi-Fi discovery/overview endpoints. GSM/ULTRA, shared-access discovery and MQTT telemetry are outside this slice.

## Setup and login

Requirements: Node.js 22 or later and npm, with internet access. The local build/tests have been run on Node 24.15.0; CI also checks Node 22.

```sh
npm ci
npm run prepare:auth
npm run diagnose -- login
```

`prepare:auth` fetches a single source file through GitHub's contents API at the pinned community revision recorded in the research notes. It verifies the file's SHA-256 and extracts the existing bootstrap bearer as data, without executing upstream code. The bearer is needed before a user token exists. It is written only to `.local/auth/bootstrap-token`; it is never printed or included in the repository. This is an unofficial protocol dependency that may stop working if the vendor changes authentication.

The login command must run in an interactive terminal. All input is hidden, including the phone number and OTP. Enter the number associated with MyCentsys Remote, including the country code. National-only numbers are rejected rather than assigned a guessed country. Regions are `za` (default) and `au`; OTP channels are `whatsapp` (default, wire value 1) and `sms` (wire value 2), based on the reference implementation.

Completing the phone/region/channel prompts requests one OTP. A successful SendOtp response means the service accepted the request, not that delivery occurred. No automatic resend or login retry occurs. Enter the received code to obtain a session, which is saved in `.local/auth/session.json`. An existing session is preserved if a new login fails before storage.

These files contain sensitive credentials in plaintext with directory mode 0700 and file mode 0600. The client rejects group/world-readable credentials and symlinked credential files. Git ignores the entire `.local/` directory. Do not attach it to issues or include it in shared backups. Tokens are intentionally never accepted as command-line arguments.

## Read status

```sh
npm run diagnose -- status
```

Each invocation performs one discovery and, if devices exist, one overview request for their serial numbers. It prints a JSON report with aliases such as `gate-1`, product codes, the discovery online flag, and decoded gate state. Aliases follow discovery order and are not stable device identities across runs.

HTTPS state codes from the source reference are:

| Code | State |
| --- | --- |
| 0 | Unknown |
| 1 | Open |
| 2 | Closed |
| 3 | Partly open |
| 4 | Partly closed |
| 5 | Opening |
| 6 | Closing |

These are not HomeKit or MQTT numeric values. Unrecognized integers stay `unknown` with their raw state code available in the report. Strings such as `"2"` or malformed envelopes are rejected instead of silently coerced. Duplicate/conflicting device identities and unsolicited overview identities fail the operation. Missing overview rows remain unknown, and an actual empty discovery list is distinguished from a malformed response.

Beam, power and alarm values remain raw nullable numeric codes pending hardware validation. A disabled beam code is not treated as proof of a clear path. Product code/type values are reported without guessing a motor model or selecting any activation command.

`receivedAt` is when the client received its data; **the gate's measurement time is unknown**. `onlineAtDiscovery` and `cloudReportedState` may disagree because these endpoints can reflect different cached observations. This tool does not claim current physical position, sample-age guarantees or motion-resolution updates. The later MQTT phase will validate live updates. A successful cloud overview is not sufficient evidence for sending a toggle command.

All requests have a ten-second deadline, including body reads; response bodies are limited to 1 MiB. Redirects are rejected and normal TLS verification stays enabled. There are no automatic retries. HTTP 401/403 require reauthentication; 429 requires waiting before a user-initiated retry. Errors contain fixed categories, without raw server text, URLs, headers or credentials.

## Read a known SMART+ operator

If discovery is empty but you have the serial from your own Pro Operator Information screen, create `.local/auth/operator.json` locally with a JSON `serialNumber` string containing that serial. Copy it from the app to avoid transcription errors. Set its permissions to 0600; the existing auth directory must remain 0700. This manual SMART+ path requires exactly 24 hexadecimal characters and never guesses, pads or truncates an identity. Do not put the actual serial in a public issue, commit or command-line argument.

```sh
chmod 600 .local/auth/operator.json
npm run diagnose -- status-known
```

This bypasses discovery for one explicitly configured operator and sends only an overview request. The report marks `identitySource` as `owner-configured`, with unknown online/product metadata. A successful read does not establish automatic account discovery, live MQTT access, or permission for any activation command. The ordinary `status` command continues to test discovery. Missing/malformed/insecure operator files fail with `local-storage`.

## Live validation

After login, share only the sanitized output from `status`. First establish whether this account's gate appears and which numeric product codes it reports. Then compare repeated reports against the official app during an observed opening/closing cycle. Keep cloud-cached responses and missing states as findings; do not adjust decoding to force an expected result. The earlier silent SMART Plus Retrieval result makes discovery itself an open test.

If no operators are returned, compare the account number and Remote-user linkage. Do not delete working app entries automatically. If authentication is rejected, repeat the explicit login flow. `local-storage` usually means preparation/login has not been completed or credential permissions are incorrect; raw filesystem errors are intentionally not printed.

## Remove the saved session

```sh
npm run diagnose -- logout
```

Logout deletes the local session only; it does not revoke a vendor token remotely. The bootstrap file remains for a later explicit login.
