# CENTSYS Homebridge feasibility

Investigated 9 September 2026. This is a research assessment, not a claim of compatibility with the owner's hardware.

## Assessment

The owner reports successful opening and closing through MyCentsys Remote after walking far from the gate, with no Bluetooth connection, and confirms the app displayed Closed, Opening, Open and Closing during the test. Together with the controller reporting Connected to Cloud, this is strong evidence that cloud control and state feedback are viable for this installation. Cloud is the chosen implementation route. Third-party OTP authentication now succeeds, but account discovery returns no operators. Telemetry decoding/freshness and Homebridge command behavior remain untested. See [live validation](VALIDATION.md).

The product names in the supplied screenshots are **CENTSYS / CENTURION** and **MyCentsys Pro**. The screenshot gives Pro version **1.5.0.213**. Later Operator Information screenshots identify the installed motor as D5 Evo SMART+, with Core and Comms Interface firmware both 2.1.0.0.

## Successful remote-control test — 9 September 2026, around 15:41

The owner reports walking far away, successfully opening and closing the gate, and confirming no Bluetooth connections. Treat this as an owner-observed functional result, not an agent packet capture. The attached iOS screenshot shows Bluetooth enabled, visible listed accessories disconnected, and a Wi-Fi icon; it does not independently establish the gate's transport or a cellular-only connection. The distance test and owner report are the evidence for operation without a nearby Bluetooth link.

The owner subsequently confirmed that the app displayed **Closed → Opening → Open → Closing** during the same distance test. Both remote actuation and changing state feedback have therefore been observed through the official app. Latency was not measured; stopped/partially open, obstruction, and connectivity-loss behavior were not tested. This is sufficient to proceed with a cloud client prototype; our own protocol implementation still needs independent validation.

## Installation and completed checks

- Confirmed by Pro Operator Information at 16:10: D5 Evo SMART+, Core 2.1.0.0 and Comms Interface 2.1.0.0. The serial is stored only in ignored local data.
- Host: iHost on the same property, approximately 15 metres from the motor. Homebridge runtime/container details remain unverified.
- MyCentsys Pro: **1.5.0.213**. MyCentsys Remote: **2.1.0.38**.
- At 14:43 the controller reported Wi-Fi enabled, excellent signal, and **Connected to Cloud: Yes**. Power saving was off; the secondary network was unconfigured. Network identifiers are omitted.
- At 15:04 the owner's Remote-user profile was present in Pro with a green check; both operator-admin and Remote-user membership have been observed.
- Bluetooth-disabled attempts produced Unknown / Device not in range and repeated iOS Bluetooth-enable prompts. These attempts did not isolate a cloud failure reliably.
- SMART Plus Retrieval displayed a retrieving message without a visible result. After the owner removed the Remote app entry, manual re-add succeeded; retrieval did not visibly restore it. The later distance test succeeded. We have not established whether re-add caused that success.

The manufacturer's manual distinguishes manual BLE addition from automatic retrieval of cloud-linked SMART+ operators. The silent retrieval result remains relevant to testing our own account discovery, but it no longer blocks the cloud feasibility decision. [D-Series SMART+ manual, section 10.13.3](https://www.centsys.co.za/pdf/prod/plus/1401.D.01.0029%20D-Series%20SMARTplus%20Combined%20Manual%2023022026_AP_Web_App.pdf).

For the cloud design, iHost communicates over the internet to CENTSYS, and the controller uses its Wi-Fi internet connection. No direct iHost-to-gate Bluetooth connection is required. If low-battery Wi-Fi power saving is enabled later, the plugin must represent connectivity loss as unavailable state, not infer that the gate is closed.

## Evidence from the screenshots

The images are observations, not instructions to operate or reconfigure the gate. Personal account details and the gate's identifying label are omitted here.

| Observation | What it establishes | What it does not establish |
| --- | --- | --- |
| Overview shows Current Connection: Direct | The app has a direct session | A LAN IP address or local HTTP API |
| Wi-Fi status shows Disabled | Wi-Fi is shown as disabled in this session | Whether the installed board has Wi-Fi hardware |
| Overview and IO4 show Closed | The app can display controller-reported gate state | That state is accessible through a third-party protocol, or its update latency |
| Controls include TRG, PED, FRX, LCK and KEEP | The app exposes several controller functions | Separate, idempotent open and close commands |
| About lists firmware for many SMART and SMART+ controllers | The app bundles support for several products | Which product is actually installed |
| Remote Session has no devices listed | That screen is empty at capture time | That all remote/cloud access is impossible |
| IRBC/IRBO disabled; IRBC input not configured | Closing/opening beam monitoring is not shown as active | That the driveway is clear, or that no other protection exists |

The combination of Direct and disabled Wi-Fi is consistent with Bluetooth. CENTURION explicitly documents a Bluetooth connection in the same Pro admin-user flow and identifies BLE in its troubleshooting instructions. This is a strong inference about this session, not a packet capture. [Admin-user guide](https://support.centsys.co.za/portal/en/kb/articles/how-to-add-a-new-mycentsys-remote-user-for-your-centurion-smart-motor), [BLE troubleshooting](https://support.centsys.co.za/portal/en/kb/articles/first-time-users-facing-smart-motor-connection-failure-on-the-mycentsys-pro-app).

## Available routes

| Route | Current evidence | Assessment |
| --- | --- | --- |
| MyCentsys cloud | Owner reports remote open/close and Closed/Opening/Open/Closing feedback; public client code exists | Selected route; third-party access, decoding and freshness remain unverified |
| Direct Bluetooth | Official Pro connection mechanism; no usable CENTSYS BLE implementation established in this investigation | Possible, but authentication, protocol, range and reconnect behavior remain research work |
| Direct local Wi-Fi API | No supported local LAN API established | Do not equate Wi-Fi connectivity with a local API |
| Wired local interface | Manufacturer documents trigger inputs and a gate-status output; community hardware projects bridge these into HomeKit | Practical fallback, subject to board revision and electrical interface verification |

Official documentation distinguishes BLE operation from SMART+ Wi-Fi connectivity. It describes Wi-Fi configuration as SMART+ only. MyCentsys Pro handles installer configuration, while MyCentsys Remote provides normal control and device status. The remote-support session feature is a separate workflow. [V-Series SMART+ manual, printed page 40](https://www.centsys.co.za/pdf/prod/plus/1408.D.01.0009%20V-Series%20SMARTplus%20Combined%20Manual%2023022026_AP_Web_App.pdf), [SMART ecosystem](https://www.centsys.co.za/smart-ecosystems/), [remote-support sessions](https://www.centsys.co.za/remote-sessions-via-mycentsys-faster-support-fewer-unnecessary-trips/).

The public [centsys_remote integration](https://github.com/Lex-campbell/centsys_remote) is a useful protocol reference, not proof that the owner's gate works with it. Its cloud route uses HTTPS and MQTT; it does not supply a Bluetooth client. Its open and close actions both issue a trigger, so its command behavior must be redesigned for dependable HomeKit targets. See the [source-level research](research/connectivity.md) for the pinned revision, authentication details and limitations.

For a wired fallback, CENTURION documents TRG/PED and gate-status wiring to an external G-ULTRA on the D5 EVO SMART. This establishes an intended external interface, not compatibility with any arbitrary relay or GPIO board. An alternative local bridge could use an isolated momentary relay and a properly interfaced status input, or separate position sensors. [Manufacturer wiring guide](https://support.centsys.co.za/portal/en/kb/articles/how-to-wire-a-g-ultra-to-a-d5-evo-smart-sliding-gate-operator).

The independent [HomeSpan D5-Evo project](https://github.com/ixy05/homespan-d5evo-gate) demonstrates the relay-plus-status approach on a different motor generation. It uses pulse-pattern decoding and signal-level conversion. Its voltages, timing and wiring cannot be assumed to apply to the owner's D5 Evo SMART+ controller. A single closed-position sensor can answer “fully closed or not”; it cannot independently establish fully open, travel direction or obstruction.

## Proposed Homebridge design

Use one `GarageDoorOpener` service named Gate. Homebridge's HAP implementation requires current door state, target door state and obstruction indication. This service gives the appropriate open/close behavior; Home may present it with garage-door styling. [HAP service definition](https://github.com/homebridge/HAP-NodeJS/blob/029e8165680a0f17a3d02714b0aec3c379c7bc93/src/lib/definitions/ServiceDefinitions.ts#L611-L630).

Proposed internal separation:

1. **Transport client:** the chosen cloud, BLE or hardware connection; owns authentication and reconnects.
2. **Gate coordinator:** observed state, freshness, one command at a time and post-command reconciliation.
3. **Homebridge accessory:** maps observed state and accepted targets to HAP, with stable accessory identity.

Implement only the verified transport initially. Keep protocol details outside the accessory so a later transport does not require rewriting HomeKit behavior.

The main command rules are design requirements, not verified CENTSYS behavior:

- Treat open/close as desired destinations. A request matching the known state does nothing.
- If the available command is a toggle, require fresh state and a verified operating mode. Reject ambiguous requests while stopped partway, moving in an unsupported direction, stale or offline.
- Never automatically replay a trigger after a timeout: the first request may have moved the gate.
- Confirm motion and final position from telemetry. A successful network request is not proof of movement or arrival. Never manufacture Closed from an elapsed timer.
- Reconcile changes from physical remotes and the app. Do not send gate commands at startup or replay commands after reconnect.
- Preserve unknown state and unknown obstruction as unavailable/error information. Disabled beam inputs must not be decoded as proof of a clear path. The precise obstruction mapping needs controller telemetry verification before release.

## AquaTemp reuse

Inspected the existing local project at `/Users/dean/_repo/deanvanniekerk/homebridge-aqua-temp`, particularly `package.json`, `src/platform.ts`, and `docs/ARCHITECTURE.md`.

Reusable conventions include TypeScript/ES modules, a dynamic platform, stable accessory identities, separate protocol/coordinator/presentation responsibilities, redacted diagnostics, freshness handling, bounded reads and no automatic write replay. Its Homebridge lifecycle and release checks are useful references.

AquaTemp's HTTP authentication, thermostat model, polling intervals and absolute setting writes are specific to the heat pump. The gate requires new protocol code and motion-aware command handling. Runtime versions should be selected against the actual Homebridge host when implementation starts rather than copied without verification.

## Next implementation steps

1. **Resolve discovery in the read-only client.** OTP login works; SMART Wi-Fi discovery returns an empty list, and backup/shared-access probes found no entries. Inspect controller identity and cloud Remote-user linkage, then validate the overview. Keep credentials, certificates and raw identifying responses out of the repo/logs.
2. **Establish identity and state mappings.** Use the screenshot-confirmed D5 Evo SMART+ / 2.1.0.0 identity, validate our client's open/closed/moving/stopped telemetry and its freshness, and retain sanitized fixtures. Compare against the Closed/Opening/Open/Closing states already observed by the owner in the official app.
3. **Implement cloud control and reconciliation.** Validate family-specific trigger semantics and operating mode before issuing commands. Serialize target requests, suppress already-satisfied requests and never replay ambiguous trigger timeouts. Validate actual movement with someone observing the gate; the earlier disabled beam inputs must be considered before unattended closing.
4. **Integrate Homebridge.** Expose one GarageDoorOpener service, following the AquaTemp lifecycle/configuration conventions. Verify the iHost Node/Homebridge/container environment, then test stale status, reconnects, physical-remote changes, pairing and target-state requests.

Only official-app control has been exercised by the owner. The agent completed third-party OTP login and read-only cloud discovery. Discovery returned no operators; a later overview request using the owner-supplied serial also returned no rows. No Homebridge hardware test, agent network scan or agent gate actuation has been performed.
