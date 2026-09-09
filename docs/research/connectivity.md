# CENTSYS connectivity and public protocol research

Research date: 9 September 2026. Scope: official app connectivity and public integration source code. No account login, network probing of the installation, or gate operation was performed.

Latest installation evidence around 15:41: the owner reports successful opening/closing after walking far from the gate and confirming no Bluetooth connection. Together with controller-reported cloud connectivity, this supports proceeding with a cloud implementation. Exact model, third-party authentication/discovery and fresh state feedback remain unverified. See [successful remote-control test](../FEASIBILITY.md#successful-remote-control-test--9-september-2026-around-1541).

## Findings

A Homebridge integration is technically credible. The original screenshots show **MyCentsys Pro 1.5.0.213**, **Current Connection: Direct**, **WiFi Status: Disabled**, and actual **Closed** gate status; the later 14:43 image establishes controller-reported cloud connectivity after Wi-Fi setup. The About screen lists firmware bundled with the app for many controller families; it does not identify the installed motor or firmware. The admin-user screen is distinct from the MyCentsys Remote users tab. Personal identifiers in the screenshots are intentionally omitted here.

**Inference:** the active Direct connection is most likely Bluetooth Low Energy (BLE), not the home LAN. CENTURION explicitly identifies BLE as the Pro app's connection mechanism when troubleshooting SMART operators. Disabled Wi-Fi is evidence of its current state, not proof that the hardware lacks Wi-Fi. [Official BLE troubleshooting](https://support.centsys.co.za/portal/en/kb/articles/first-time-users-facing-smart-motor-connection-failure-on-the-mycentsys-pro-app).

## SMART, SMART+, and the apps

| Connection | Evidence and implications |
| --- | --- |
| SMART local connection | MyCentsys Pro configures SMART equipment over BLE. MyCentsys Remote can also operate equipment while nearby; the name “Remote” does not itself imply internet access. [Pro BLE support](https://support.centsys.co.za/portal/en/kb/articles/first-time-users-facing-smart-motor-connection-failure-on-the-mycentsys-pro-app), [Remote product page](https://www.centsys.co.za/centurion-mycentsys-remote-app/). |
| SMART+ Wi-Fi | CENTURION's 9 March 2026 Pro release announcement explicitly limits the new operator Wi-Fi connectivity and remote sessions to SMART+. It does not say that installing a new app upgrades an older SMART controller's hardware. [Official release](https://www.centsys.co.za/mycentsys-pro-installer-app-1-5-0-179/). |
| SMART+ internet control | CENTURION describes a cloud-based system for remote control, live status and installer diagnostics. It is not documentation of a LAN HTTP API. [Official ecosystem description](https://www.centsys.co.za/smart-ecosystems/). |
| GSM/ULTRA | Public integration code has a separate cellular-gateway path for G-ULTRA/G-SPEAK installations. Position feedback depends on the module's configured inputs; merely having a working trigger does not guarantee open/closed telemetry. [Public integration](https://github.com/Lex-campbell/centsys_remote#supported-devices). |

The current official SDO5 SMART+ installation manual makes the distinction particularly clearly: adding a nearby SMART/SMART+ device manually uses BLE, while a SMART+ operator connected to Wi-Fi appears automatically in MyCentsys Remote when the account is configured as a Remote user. This is cross-family connectivity documentation, **not evidence that the user's gate is an SDO5**. [Official manual, section 8.3, page 48](https://www.centsys.co.za/pdf/prod/plus/1415.D.01.0001%20SDO5%20SMARTplus%20Installation%20Manual_02032026_AP_Web_App.pdf).

For a compatible controller, the official Wi-Fi path is bottom **… → Settings → Wi-Fi Settings → enable Wi-Fi → Primary Wi-Fi Connection → Scan for Networks**, then select the network, save, and check Advanced Wi-Fi Configuration. Inspecting whether this menu exists is a useful next identification step. [Official Wi-Fi guide](https://support.centsys.co.za/portal/en/kb/articles/smart-controller-wifi-connection).

## A concrete cloud implementation already exists

The strongest software lead is [Lex-campbell/centsys_remote](https://github.com/Lex-campbell/centsys_remote), a beta Home Assistant integration. Its README reports tested Wi-Fi support for D5 Evo SMART, D6 SMART+ and SDO5 SMART+. Those are the author's compatibility reports, not independent testing on this installation. Its shorthand “D5 Evo SMART Wi-Fi” should not override the manufacturer's SMART/SMART+ distinction. A direct BLE-only admin connection is insufficient for its cloud device discovery; the account must be linked as a Remote user. [README](https://github.com/Lex-campbell/centsys_remote#requirements).

Source inspection below is pinned to commit `4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba`. These are observations of executable source, not a vendor API contract or claims that we exercised the service.

### Authentication and transport

- HTTPS `SendOtp` and `ValidateOtp` implement phone-number/OTP login and yield a session JWT. The initial OTP request uses an embedded service-level bearer before a user token exists; this is a compatibility dependency to assess before adopting the flow. No bearer values are copied into this report. `GetDevicesByRemoteUserNumber` discovers linked operators; `GetOperatorOverview` reads cloud status. [client.py](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/client.py).
- The South Africa HTTPS gateway is `https://centsys.southafricanorth.cloudapp.azure.com:4445`; the code also defines an Australia gateway. Wi-Fi control uses a remote MQTT broker on port **8880**, not a POST to a motor's LAN IP. [API constants](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/const.py).
- `GetCertificate` returns a PKCS#12 client certificate for **MQTT v5 with mutual TLS**. MQTT uses the account-derived `mcr:<number>` client ID and operator serial prefixes. The TLS implementation loads a pinned CA and verifies against `CentsysQA` because it connects by IP; it relaxes Python's strict X.509 flag for certificate compatibility rather than disabling chain/hostname verification. This needs deliberate handling in a Node implementation. [client.py](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/client.py), [mqtt_remote.py](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/mqtt_remote.py).
- MQTT actuation exchanges connection request, identity, time-sync, challenge and activation packets over `<serial>/connectionRequest` and `<serial>/userRemoteTrigger` plus response topics. `deviceOverview` carries binary state/diagnostics. This is enough protocol detail to build a TypeScript adapter; it is substantially more than a simple REST client. [MQTT transport](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/mqtt_remote.py), [packet codec](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/packets.py).

### Command and state details that affect Homebridge

The upstream `async_open_cover` and `async_close_cover` both unconditionally call the same `_trigger()` method. It sends TRG for gates or RUN for a positively identified garage controller. **These are pulse/trigger semantics, not separate idempotent “set open” and “set closed” commands.** UI button disabling is not an adequate guard for HomeKit requests, automation calls, or stale state. A Homebridge target-state controller should obtain fresh state, serialize requests, suppress duplicate/already-satisfied targets, and reject unknown or unsupported transitions. [cover.py](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/cover.py).

Do not generalize numeric commands across product families: activation **1** means garage RUN but gate Holiday Lock; gate TRG is **34**, PED **35**. The source itself calls out this collision. [packets.py](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/packets.py).

Cloud and MQTT state enums differ. HTTPS uses unknown/open/closed/partly-open/partly-closed/opening/closing values 0–6, while sliding/swing MQTT uses open/closed/partly-open/partly-closed/opening/closing values 0–5; garage MQTT has another mapping. Decode each transport and family separately and reject unfamiliar frame layouts instead of guessing for actuation decisions. [enums.py](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/enums.py), [telemetry decoder](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/api/mqtt_remote.py).

The implementation polls cloud status every 60 seconds, normally refreshes heavier MQTT telemetry every 600 seconds, and follows MQTT for 75 seconds after an integration-triggered action. Live status expires after 20 seconds before falling back to HTTP. Consequently “real time” is not a blanket guarantee for changes made with a physical remote while no stream is active. The cadence also reflects the author's concern about waking battery-backed radios. [Constants](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/const.py), [coordinator.py](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/custom_components/centsys_remote/coordinator.py).

The MIT license permits adaptation with the copyright and permission notice retained for copied/substantial portions. It is not vendor endorsement or a promise of backend stability. [Pinned license](https://github.com/Lex-campbell/centsys_remote/blob/4d6daab50e4305fe2d3ea2c0d2df6e65737e1dba/LICENSE).

## Gaps and next decision

The owner's distance test now supports cloud control feasibility. Earlier Bluetooth-disabled errors and a recurring iOS prompt were not conclusive cloud tests. Remote is version 2.1.0.38, the owner's Remote-user entry is present with a green check, and manual re-add succeeded despite SMART Plus Retrieval yielding no visible result. Third-party discovery must still be tested rather than inferred from successful app control.

The [South African iOS listing](https://apps.apple.com/za/app/mycentsys-remote/id1626441948) mentions third-party webhook integration in the 2.1.0.38 notes. Direction, authentication and gate-state/control capabilities are unspecified; this is a lead, not a verified alternative API.

No published manufacturer developer API/SDK or working native BLE integration was located in this search. This is a scoped negative result, not proof none exists. The discovered cloud implementation contains no BLE transport, so it cannot simply be pointed at the presently shown Direct connection.

A different repository, [andrew-snape/centurion-garage-HAS](https://github.com/andrew-snape/centurion-garage-HAS), calls a local `http://<IP>/api?key=...` endpoint for garage equipment. Its [source](https://github.com/andrew-snape/centurion-garage-HAS/blob/main/custom_components/centurion/cover.py) does not establish compatibility with CENTSYS SMART gate controllers or MyCentsys. It must not be cited as proof that this gate exposes a LAN API.

Proceed with authenticated read-only discovery/status and identify the actual controller model/firmware before command encoding. The remaining state question is whether the official app displayed fresh position changes during the owner's successful remote-control test. No third-party protocol or Homebridge hardware test has run yet.
