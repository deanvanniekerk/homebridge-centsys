# homebridge-centsys

A Homebridge plugin in development for CENTURION / CENTSYS SMART+ gates, with a browser login wizard, gate-state monitoring and experimental open/close control.

**Status: alpha.5 completed one owner-confirmed physical open-and-close cycle through Apple Home on iHost.** Both commands received success responses on their first attempt, and Home displayed Opening → Open → Closing → Closed. Reliability and real gate-offline testing remain in progress. Automatic account discovery is empty on this installation, so setup supports a manually supplied serial and validated protocol address.

The tested controller is **D5 Evo SMART+**, Core and Comms Interface firmware **2.1.0.0**. Experimental command handling is limited to this profile in South Africa and is disabled by default. It requires a fresh MQTT session, serializes commands and never automatically repeats an uncertain activation. One explicit configuration-version mismatch permits a corrected-version retry; this negotiation is tested in simulation and awaits hardware validation.

## Homebridge setup

Use Homebridge 2.4.x and Node 22 or 24. Install the development tarball, open the plugin's settings, and follow the phone/OTP wizard. Select a discovered gate or enter its serial, check status, save and restart. Session credentials live in Homebridge's persistent storage, so restarting or updating the plugin does not require another login unless the vendor rejects the session.

See [installation, storage and control limitations](docs/INSTALLATION.md). No npm release has been published, and `private: true` prevents accidental publication.

## Development and diagnostics

```sh
npm ci
npm run check
npm pack
```

The independent research CLI remains available:

```sh
npm run prepare:auth
npm run diagnose -- login
npm run diagnose -- status
npm run diagnose -- status-known
```

`status-known` requires an owner-only `.local/auth/operator.json` containing your own controller serial. CLI credentials are separate from deployed Homebridge credentials. All diagnostic output omits identifying account/device fields and labels HTTP readings as potentially cached.

- [Diagnostic CLI guide](docs/DIAGNOSTICS.md)
- [Implementation and validation evidence](docs/VALIDATION.md)
- [Feasibility and design](docs/FEASIBILITY.md)
- [Protocol research](docs/research/connectivity.md)

Independent project, not affiliated with CENTURION, Apple or Homebridge. Adaptation credits and the upstream MIT license are in [third-party notices](THIRD_PARTY_NOTICES.md).
