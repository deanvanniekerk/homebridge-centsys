# Installing the development plugin

This alpha provides a Homebridge GarageDoorOpener accessory, a browser setup wizard, HTTPS monitoring and experimental MQTT control. Alpha.5 completed one owner-confirmed physical open-and-close cycle, with both movement directions and endpoints displayed in Apple Home. Alpha.6 is installed on the owner's iHost and has displayed No Response during a real gate Wi-Fi outage. Recovery from that outage and monitoring/control handover on alpha.6 remain to be checked. npm publication remains disabled; install a development tarball for testing.

## Requirements and package

- Homebridge 2.4.x, with its Homebridge UI.
- Node.js 22 or 24.
- Internet access from Homebridge to CENTSYS HTTPS and MQTT services, and GitHub for first-login bootstrap preparation.
- Homebridge storage mounted on persistent disk. For containers, persist the Homebridge storage volume, not the plugin's install directory.

From a development checkout, `npm ci`, `npm run check` and `npm pack` produce the installable tarball. Install the tarball through the same npm environment used by Homebridge (for example `npm install /absolute/path/homebridge-centsys-0.1.0-alpha.6.tgz` from the Homebridge npm project). The exact install location/global flag depends on that Homebridge deployment; do not install into a different Node environment on the host by accident. Restart Homebridge after installation, then open the plugin's settings. A dedicated child bridge has started successfully on the target iHost runtime and isolates subsequent plugin restarts.

## Browser setup

1. Enter the MyCentsys account's international phone number, region, and WhatsApp/SMS preference; click **Send code**.
2. Enter the received OTP and click **Sign in**. Keep the settings modal open until this completes.
3. Click **Find account gates**. If discovery is empty, copy the 24-character serial from Pro's Operator Information screen into the form.
4. Set the Home name and validated **protocol MAC address**, click **Check gate status**, then **Save gate**. Start with control disabled. The status button is a cloud preview; runtime availability also requires live telemetry. Monitoring currently supports the tested D5 Evo SMART+ profile in South Africa.
5. Restart the plugin's child bridge or Homebridge. Add the bridge/accessory in Apple Home using Homebridge's normal pairing process.

The plugin's server prepares the pinned bootstrap credential on the first explicit code request. No shell command or token copying is required for UI setup. This remains an unofficial protocol dependency: the file hash must match the pinned source, and a vendor change can require a plugin update.

The UI process owns a short-lived login challenge, allows up to five code-verification attempts, and persists a one-minute resend cooldown. Closing the modal discards the pending challenge; a saved session remains intact. Failed login attempts do not overwrite an existing working session. The session's lifetime is not established, and no supported refresh protocol is assumed. A rejected session is shown as **Sign-in required** when settings checks it; runtime authentication failures mark gate state unavailable. No automatic code requests or gate activations occur.

## Storage and updates

Private files live under `<Homebridge storage>/centsys/auth/`, directory 0700 and files 0600. The token and bootstrap are plaintext protected by filesystem permissions, not encryption against the Homebridge host administrator. They are not returned to the browser or written into the plugin configuration, accessory cache, logs or npm package. OTPs are never persisted. Standard Homebridge backups may include the persistent storage directory, so treat them as sensitive.

The normal configuration contains gate names, serials, protocol MAC addresses and optional control profiles. Those are device identifiers: avoid posting your real config publicly. The browser backend and runtime use the same Homebridge storage path. Package upgrades do not remove that path. The research CLI's `.local/auth` is separate and is not silently imported into a deployed Homebridge installation.

Signing out removes this Homebridge's local session, not the official app's login and not a remotely revoked vendor token. Monitoring notices the missing session on its next poll; an in-flight command rechecks the saved account immediately before activation. Restart after changing accounts or gates to apply configuration changes.

## Monitoring and HomeKit state

The accessory maps Open/Closed/Opening/Closing to HomeKit door states and partly-open/partly-closed to Stopped. Alpha.6 additionally requires a verified live MQTT identity and non-retained telemetry before it exposes an available state. The last live verification expires after 45 seconds, independently of successful HTTPS responses. An expiry timer marks the HomeKit characteristics with communication failure even if cloud polling keeps returning a cached Closed value. This is not a 45-second guarantee for Apple Home's visible tile: the real outage test showed Closed after the plugin reported unavailability, then No Response on a later observation. Missing protocol addresses or unsupported regions remain unavailable; the cloud-preview button and research CLI can still show explicitly labelled cloud-reported status.

The default idle poll is 15 seconds. A newly observed moving state or control request enables a bounded 60-second observation period with nominal two-second delays. Live verification is renewed when its age reaches 20 seconds, including when a longer idle poll interval is configured. A newly renewed live state takes precedence over the HTTP state for that read. Subsequent HTTP reads can update position but never extend the live-verification timestamp. Probe latency adds to these timings; failed reads back off up to five minutes. Recovery may therefore wait for the next retry. Monitoring sends connection, identity and disconnect packets only. Before control connects, it cancels and awaits any monitoring session teardown to avoid overlapping the shared account client ID. Multiple configured gates are verified sequentially; timing and long-running load have only been evaluated for one gate. Vendor rate limits and battery impact remain unvalidated.

Obstruction remains **unknown internally** unless fresh MQTT telemetry supports a known result. HomeKit requires a Boolean: the plugin reports `true` only for a detected obstruction, otherwise `false` means **no obstruction reported**, not a confirmed clear path. Disabled or missing beam feedback is not a safety measurement. Actual unavailable/stale gate state still returns a communication error. Alpha.0 incorrectly returned that error for missing obstruction feedback even while the gate state was readable, producing an Apple Home No Response report; alpha.1 corrects this presentation mapping without changing command checks. See [Apple’s obstruction characteristic definition](https://developer.apple.com/documentation/homekit/hmcharacteristictypeobstructiondetected).

## Experimental control

The default is monitoring only. The advanced UI option requires a D5 Evo SMART+ in South Africa, its protocol MAC address, and confirmation that the installed TRG mode opens a fully closed gate and closes a fully open one. Use the cloud device listing's `macAddress` or an independently validated protocol address. The Wi-Fi MAC displayed by MyCentsys Pro was not the correct key source on the investigated installation; do not assume the two addresses are interchangeable or apply the observed conversion to every controller. Other motor families/regions are not supported for activation in this alpha.

Each request obtains a new MQTT identity challenge and non-retained telemetry over verified mutual TLS. Matching endpoints/directions are no-ops; opposing motion, intermediate/unknown state, known obstruction or reported inhibiting conditions reject the request. Unknown obstruction is not proof of a clear driveway; enabling control does not establish the installation's safety equipment or suitability for unattended closing.

Before each TRG publish, the session rechecks state age and the locally saved account. The first packet uses configuration version 0. Only an explicit code-7 configuration mismatch with a different returned version permits one corrected-version retry, matching the pinned Home Assistant reference. A second mismatch, another rejection, an uncertain reply, timeout or disconnect stops the request. Logs retain only the numeric response code, configuration version and attempt number. Commands are serialized per account, and shutdown cancels outstanding work. HomeKit acknowledges an accepted command promptly; that acknowledgement means queued, not physically activated. One command job, including certificate retrieval, has a 30-second overall deadline and a 25-second MQTT-session limit. This accommodates the observed roughly 14-second wait for initial telemetry. Busy, disabled and invalid requests are rejected immediately. Later failures update the accessory state and logs, and do not trigger retries. The displayed current state is never changed to Opening merely because a request was queued. A command can therefore begin moving the gate several seconds after the HomeKit request; keep the path clear throughout the attempt. With the corrected protocol address, alpha.5 completed one owner-confirmed physical HomeKit open-and-close cycle. Both replies were success code 1 on their first attempt with configuration version 0. Corrected-version negotiation is covered by simulated protocol tests; it was not needed in this cycle. Arrange an observed test for each installation before routine control.

A successful activation acknowledgement is not proof that the gate moved or reached the target. The coordinator keeps polling actual state; it never invents Closed from a travel timer.

A real Wi-Fi outage on alpha.5 confirmed that the vendor can keep reporting Closed while the gate is disconnected. In the repeated owner-assisted outage on alpha.6, Apple Home eventually displayed No Response. The exact visible transition latency was not measured. Plugin availability is bounded by the last live observation; Apple Home display refresh can add delay.
