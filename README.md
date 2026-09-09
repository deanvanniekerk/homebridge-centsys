# homebridge-centsys

A Homebridge plugin in development for controlling CENTURION / CENTSYS gates from Apple Home, with open/close control and gate-state reporting.

**Status: read-only cloud client implemented; Homebridge integration pending.** The owner reports successful remote open/close through MyCentsys Remote outside nearby Bluetooth range, with displayed Closed, Opening, Open and Closing states during the test. Live OTP login succeeded, but SMART Wi-Fi discovery returned no operators for the account. The client has 26 passing local tests; live gate-status validation remains blocked on discovery. There are no gate commands or installable Homebridge accessories yet, and npm publication is disabled.

The intended accessory provides open/close requests and observed gate state through Homebridge on iHost. The current diagnostic client supports phone/OTP authentication, discovery and HTTPS operator overviews. The exact controller model and firmware remain to be confirmed.

## Run the diagnostic client

Use Node.js 22 or later. From this repository:

```sh
npm ci
npm run prepare:auth
npm run diagnose -- login
npm run diagnose -- status
```

Login asks for your registered international phone number, region, OTP delivery channel and code. Input is hidden. Credentials stay under ignored `.local/auth/` with owner-only permissions. The status report omits names, phone numbers, serials, MACs and tokens. It labels readings as potentially cached cloud data, not a live MQTT stream.

See the [diagnostic guide](docs/DIAGNOSTICS.md) for setup details, limitations and error handling. Run `npm run check` for formatting, TypeScript compilation and tests.

- [Feasibility assessment and proposed next steps](docs/FEASIBILITY.md)
- [Connectivity and existing protocol implementation research](docs/research/connectivity.md)
- [Implementation and validation status](docs/VALIDATION.md)

An independent project, not affiliated with CENTURION, Apple or Homebridge. Protocol adaptation credits and the upstream MIT notice are in [third-party notices](THIRD_PARTY_NOTICES.md).
