# Changelog

Release notes for `homebridge-centsys` live here. The release workflow publishes
the section matching `package.json` to GitHub, so the npm package, tag and GitHub
release all use the same version and notes.

## [1.1.2] - 2026-09-16

### Added

- Show a sanitized Homebridge setup screen in the README.

### Changed

- Improve npm and Homebridge plugin discovery for CENTURION and gate-related
  searches.

## [1.1.1] - 2026-09-14

### Changed

- Do not start background monitoring until at least one gate is configured.
- Declare HAP transport support for current Homebridge plugin discovery.
- Publish the matching GitHub tag and release automatically after an approved
  npm publication.
- Use this changelog as the single source for human-readable release notes.

## [1.1.0] - 2026-09-14

### Fixed

- Accept nonzero values in the three unspecified bytes of a successful MQTT
  identity response while retaining the expected envelope, length and success
  status checks.
- Continue to require fresh, non-retained gate telemetry before monitoring or
  activation is considered valid.

## [1.0.0] - 2026-09-14

### Added

- First stable release of CENTSYS SMART+ gate monitoring and guarded open/close
  control for Homebridge.
- Browser-based phone and OTP setup, gate discovery and manual SMART+ address
  verification.
- Optional privacy-preserving diagnostic logging with repeated-error suppression
  and recovery messages.

### Changed

- Simplify gate setup and preserve explicitly disabled control settings.

## [0.1.0-alpha.9] - 2026-09-10

### Changed

- Simplify the setup wizard and default control on for newly added supported
  gates while preserving existing saved choices.
- Configure npm trusted publishing with provenance through GitHub Actions.

## [0.1.0-alpha.8] - 2026-09-10

### Added

- First public npm prerelease with the Homebridge settings UI, gate-state
  monitoring and guarded D5 Evo SMART+ control.
- Validate live controller identity and telemetry before exposing gate state or
  sending an activation command.
