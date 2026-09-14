# Releases

This project follows AquaTemp's manual GitHub Actions release procedure. The package is `homebridge-centsys`: stable versions use `latest`, `X.Y.Z-alpha.N` uses `alpha`, and `X.Y.Z-beta.N` uses `beta`. Publication is an explicit maintainer decision. Hardware evidence and limitations are recorded separately in [validation](VALIDATION.md).

## Release 1.1.0

Version `1.1.0` includes the MQTT identity-response compatibility fix from PR #5. The parser accepts nonzero values in three unspecified identity bytes while retaining the expected length, header, successful status byte and fresh-telemetry checks. Physical-controller confirmation remains pending.

After this version change is reviewed and merged, dispatch **Publish npm release** on `main` with `approved_version` set to `1.1.0`. That input approves the version already recorded in `package.json`; it does not bump the version. The earlier release attempt approved `1.1.0` while the package still contained `1.0.0`, so the guard stopped it before packing or publishing. Version `1.0.0` is already published and cannot be reused.

## Stable release 1.0.0 (published)

The first stable release, `1.0.0`, was published using `publishConfig.tag: latest`. It includes the simplified gate setup and control-setting persistence from alpha.9, plus optional diagnostic logging for cloud and MQTT failures. Diagnostic logging is off by default and can be enabled in the setup wizard or with `diagnosticLogging: true` in the platform configuration. Safe failure context survives error handling, repeated failures are suppressed, and status recovery is reported.

The release keeps the existing D5 Evo SMART+ / South Africa support scope and command safeguards. It does not establish new hardware validation or resolve the intermittent protocol failures by itself; the new diagnostics enable their investigation. Existing alpha installations should select `@latest` after publication. Follow the procedure below for subsequent releases, approving each new version exactly.

## Publisher configuration

The workflow uses npm trusted publishing with provenance, without a long-lived npm token:

- npm trusted publisher: GitHub owner `deanvanniekerk`, repository `homebridge-centsys`, workflow `release.yml`, environment `npm`, with direct `npm publish` allowed.
- GitHub environment `npm`: restricted to branch `main`, with `deanvanniekerk` as required reviewer, matching AquaTemp.
- Repository variable `NPM_PUBLISH_ENABLED=true` enables publication. Keep it `false` until npm publisher configuration is complete.
- GitHub-hosted runner: Node 22.23.2 and npm 11.5.1; permissions `contents: read` and `id-token: write` for the publish job.

The maintainer configured the package-specific npm trusted publisher on 2026-09-10 with label `CENTSYS GitHub Actions`, matching the repository, workflow and environment above. `NPM_PUBLISH_ENABLED` is now true. Versions `0.1.0-alpha.8` and `0.1.0-alpha.9` already exist on npm; do not dispatch the workflow for these immutable versions. Confirm the stable publication and provenance using the checks below. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the package-specific setup. Local `npm whoami` is not an OIDC readiness check and local login is not part of the routine release procedure.

## Prepare and publish

1. Update `package.json` and `package-lock.json` to an unused version and set the matching `publishConfig.tag`. Update documentation and release notes.
2. Run `npm run check` and inspect CI for the exact commit: Node 22.23.2, current Node 22 and 24, plus emulated ARMv7. Inspect `npm pack` contents and check a clean production installation when packaging changes. Keep private credentials and raw diagnostics out of artifacts.
3. Merge the reviewed changes. Manually run **Publish npm release** on `main`, entering the exact version in `approved_version`.
4. After the workflow's checks pass, approve the `npm` environment deployment. The guard checks the exact approved version, public access, registry and matching dist-tag. A push, tag, PR or GitHub release never publishes automatically.
5. Verify the npm version, dist-tag and provenance. Create/publish GitHub release notes tied to that published commit. Hardware testing remains separate.

The local guard uses `CENTSYS_RELEASE_APPROVED`; the workflow passes the approved input through that environment variable rather than interpolating it into shell code. The publish step uses the artifact built by that workflow. Locally prepared draft archives are review aids and do not replace the provenance-bearing CI artifact.

npm versions are immutable. After an uncertain publish result, inspect the registry before retrying. Keep the previous working tarball/version for rollback and fix regressions in a new version. Never restore an old configuration over unrelated Homebridge changes.

## Distribution tag transition

Before the stable release, the registry check on 2026-09-14 showed `alpha` pointing to `0.1.0-alpha.9` and `latest` pointing to `0.1.0-alpha.8`. Publishing `1.0.0` with `--tag latest` moves stable installations onto the new release; the `alpha` tag remains on its existing prerelease. Verify `latest` resolves to `1.0.0` after publication. Future prereleases must use their corresponding `alpha` or `beta` tag.
