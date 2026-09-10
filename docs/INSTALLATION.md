# Installing the development plugin

This alpha provides a Homebridge GarageDoorOpener accessory, a browser setup wizard, HTTPS monitoring and experimental MQTT control. It has not yet been paired and exercised on the owner's iHost. npm publication remains disabled; install a development tarball for testing.

## Requirements and package

- Homebridge 2.4.x, with its Homebridge UI.
- Node.js 22 or 24.
- Internet access from Homebridge to CENTSYS HTTPS and MQTT services, and GitHub for first-login bootstrap preparation.
- Homebridge storage mounted on persistent disk. For containers, persist the Homebridge storage volume, not the plugin's install directory.

From a development checkout, `npm ci`, `npm run check` and `npm pack` produce the installable tarball. Install the tarball through the same npm environment used by Homebridge (for example `npm install /absolute/path/homebridge-centsys-0.1.0-alpha.0.tgz` from the Homebridge npm project). The exact install location/global flag depends on that Homebridge deployment; do not install into a different Node environment on the host by accident. Restart Homebridge after installation, then open the plugin's settings. A child bridge is recommended to isolate plugin restarts; this still needs validation on the actual iHost runtime.

## Browser setup

1. Enter the MyCentsys account's international phone number, region, and WhatsApp/SMS preference; click **Send code**.
2. Enter the received OTP and click **Sign in**. Keep the settings modal open until this completes.
3. Click **Find account gates**. If discovery is empty, copy the 24-character serial from Pro's Operator Information screen into the form.
4. Set the Home name, click **Check gate status**, then **Save gate**. Start with control disabled.
5. Restart the plugin's child bridge or Homebridge. Add the bridge/accessory in Apple Home using Homebridge's normal pairing process.

The plugin's server prepares the pinned bootstrap credential on the first explicit code request. No shell command or token copying is required for UI setup. This remains an unofficial protocol dependency: the file hash must match the pinned source, and a vendor change can require a plugin update.

The UI process owns a short-lived login challenge, allows up to five code-verification attempts, and persists a one-minute resend cooldown. Closing the modal discards the pending challenge; a saved session remains intact. Failed login attempts do not overwrite an existing working session. The session's lifetime is not established, and no supported refresh protocol is assumed. A rejected session is shown as **Sign-in required** when settings checks it; runtime authentication failures mark gate state unavailable. No automatic code requests or gate activations occur.

## Storage and updates

Private files live under `<Homebridge storage>/centsys/auth/`, directory 0700 and files 0600. The token and bootstrap are plaintext protected by filesystem permissions, not encryption against the Homebridge host administrator. They are not returned to the browser or written into the plugin configuration, accessory cache, logs or npm package. OTPs are never persisted. Standard Homebridge backups may include the persistent storage directory, so treat them as sensitive.

The normal configuration contains gate names, serials and optional MAC/profile settings. Those are device identifiers: avoid posting your real config publicly. The browser backend and runtime use the same Homebridge storage path. Package upgrades do not remove that path. The research CLI's `.local/auth` is separate and is not silently imported into a deployed Homebridge installation.

Signing out removes this Homebridge's local session, not the official app's login and not a remotely revoked vendor token. Monitoring notices the missing session on its next poll; an in-flight command rechecks the saved account immediately before activation. Restart after changing accounts or gates to apply configuration changes.

## Monitoring and HomeKit state

The accessory maps HTTP Open/Closed/Opening/Closing to HomeKit's corresponding door states and partly-open/partly-closed to Stopped. Missing, failed or old local observations remain unavailable. Startup never trusts a cached Closed value. The timestamp measures receipt by the plugin, not when CENTSYS measured the gate, so a successful HTTP response is not a guarantee against stale backend data.

The default idle poll is 15 seconds. A newly observed moving state or a control request enables a bounded 60-second observation period with nominal two-second delays. Failures back off instead of accelerating polls. This policy is an initial implementation; vendor rate limits and long-running behavior have not been validated.

Obstruction is **unknown** unless available MQTT telemetry supports a known result. Disabled beams do not imply a clear path. The required HomeKit obstruction characteristic returns a communication error for unknown, which may affect how Apple Home presents availability. The actual iHost/Apple Home display must be checked before treating this as a finished user experience.

## Experimental control

The default is monitoring only. The advanced UI option requires a D5 Evo SMART+ in South Africa, its Wi-Fi MAC, and confirmation that the installed TRG mode opens a fully closed gate and closes a fully open one. Other motor families/regions are not supported for activation in this alpha.

Each request obtains a new MQTT identity challenge and non-retained telemetry over verified mutual TLS. Matching endpoints/directions are no-ops; opposing motion, intermediate/unknown state, known obstruction or reported inhibiting conditions reject the request. Unknown obstruction is not proof of a clear driveway; enabling control does not establish the installation's safety equipment or suitability for unattended closing.

Before the single TRG activation, the session rechecks state age and the locally saved account. A configuration mismatch, uncertain reply, timeout or disconnect never causes an activation retry. Commands are serialized per account, and shutdown cancels outstanding work. One complete command attempt, including certificate retrieval, has an eight-second budget to finish before HomeKit's request timeout. A slow gate/certificate request is rejected before activation if that budget expires. The current clock-sync/activation/reply sequence is covered by simulated protocol tests but **has not been exercised against the physical gate**. This is the next observed hardware test; leave control disabled until arranging it.

A successful activation acknowledgement is not proof that the gate moved or reached the target. The coordinator keeps polling actual state; it never invents Closed from a travel timer.
