# CENTSYS project structure

This guide adapts the shared [Atlas project structure](https://github.com/deanvanniekerk/homebridge-atlas/blob/main/docs/PROJECT_STRUCTURE.md) to CENTSYS's HTTPS authentication, MQTT live proof, and custom Homebridge setup wizard.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Registers the `Centsys` platform with Homebridge. |
| `src/ui-server.ts` | Homebridge custom UI IPC entrypoint and fixed safe errors. |
| `src/cli.ts`, `src/prepare-auth.ts` | Owner-only diagnostic and bootstrap commands. |
| `src/settings.ts` | Plugin/platform identity, package version, and storage path. |
| `src/configuration.ts` | Runtime Zod configuration schema and normalized gate config. |
| `src/errors.ts` | Fixed error categories and safe diagnostic formatting. |
| `src/cloud/` | Bounded HTTPS/OTP transport, vendor object decoding, MQTT packets and session lifecycle. |
| `src/auth/` | Private versioned session files and cross-process MQTT lease. |
| `src/setup/` | OTP wizard operations and validated Wi-Fi address candidate. |
| `src/gate/` | Normalized gate state, cloud/MQTT gateway, freshness and command coordination. |
| `src/homebridge/` | Accessory lifecycle, stable UUIDs and GarageDoorOpener presentation. |
| `homebridge-ui/` | TypeScript wizard source, colocated tests, required JavaScript loader and browser assets. |
| `scripts/` | Release checks and ARMv7 runtime validation. |

Keep tests named `*.test.ts` beside the module they exercise. Shared test adapters use `*.test-support.ts` and are excluded from production output. The tests import source TypeScript through Vitest; the cross-process lease case also exercises a compiled child process.

## Dependency direction and contracts

Cloud code handles vendor transport and binary decoding without importing Homebridge or HAP. The gate gateway combines HTTPS, stored authentication, the session lease and MQTT. The coordinator consumes the gateway through its `Gateway` interface and publishes freshness-aware snapshots. The Homebridge platform presents those snapshots to HAP. Setup uses the same authentication and MQTT identity checks but cannot send an activation command.

Keep `PLUGIN_NAME`, `PLATFORM_NAME`, the `centsys:gate:${serialNumber}` UUID seed, IPC paths, storage path, and version 1 session JSON stable. Do not treat cached HTTPS status as live MQTT proof. No startup, retry or ambiguous command outcome may trigger a second physical action. [Validation](VALIDATION.md) records which behavior has been observed on hardware and what remains uncertain.

`src/configuration.ts` validates runtime config; `config.schema.json` describes Homebridge UI fields. The wizard defaults control on for a newly selected gate, while a raw saved gate without `enableControl` remains off. Keep both contracts and their parity tests when changing fields. Zod validates object inputs beside their owners; MQTT packet bounds and telemetry proof remain explicit byte-level checks.

## Build, checks and package

```sh
npm ci
npm run format
npm run check
npm pack --dry-run --json
```

Biome formats and lints source. `tsc` compiles `src/` into nested `dist/` JavaScript and `homebridge-ui/app.ts` into `homebridge-ui/public/app.js`; Vite transforms tests only. `npm run check:runtime` runs typecheck, build and Vitest without Biome for the emulated ARMv7 job. `prepack` builds both outputs. The package includes `dist/**/*.js`, the compiled wizard, its loader, pinned certificate, schema, release tools and required notices. Source tests, private files and raw validation captures stay out of the package.
