# Releases

This project follows AquaTemp's manual GitHub Actions release procedure. The package is `homebridge-centsys`: stable versions use `latest`, `X.Y.Z-alpha.N` uses `alpha`, and `X.Y.Z-beta.N` uses `beta`. Publication is an explicit maintainer decision. Hardware evidence and limitations are recorded separately in [validation](VALIDATION.md).

## Publisher configuration

The workflow uses npm trusted publishing with provenance, without a long-lived npm token:

- npm trusted publisher: GitHub owner `deanvanniekerk`, repository `homebridge-centsys`, workflow `release.yml`, environment `npm`, with direct `npm publish` allowed.
- GitHub environment `npm`: restricted to branch `main`, with `deanvanniekerk` as required reviewer, matching AquaTemp.
- Repository variable `NPM_PUBLISH_ENABLED=true` enables publication. Keep it `false` until npm publisher configuration is complete.
- GitHub-hosted runner: Node 22.23.2 and npm 11.5.1; permissions `contents: read` and `id-token: write` for the publish job.

The npm-side trust relationship is not yet configured. The maintainer completed the first manual publication of `0.1.0-alpha.8` on 2026-09-10. Configure its package-specific publisher in npm's account UI before enabling this workflow; do not assume AquaTemp's package authorization covers CENTSYS. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for the package-specific setup. Local `npm whoami` is not an OIDC readiness check and local login is not part of the routine release procedure.

## Prepare and publish

1. Update `package.json` and `package-lock.json` to an unused version and set the matching `publishConfig.tag`. Update documentation and release notes.
2. Run `npm run check` and inspect CI for the exact commit: Node 22.23.2, current Node 22 and 24, plus emulated ARMv7. Inspect `npm pack` contents and check a clean production installation when packaging changes. Keep private credentials and raw diagnostics out of artifacts.
3. Merge the reviewed changes. Manually run **Publish npm release** on `main`, entering the exact version in `approved_version`.
4. After the workflow's checks pass, approve the `npm` environment deployment. The guard checks the exact approved version, public access, registry and matching dist-tag. A push, tag, PR or GitHub release never publishes automatically.
5. Verify the npm version, dist-tag and provenance. Create/publish GitHub release notes tied to that published commit. Hardware testing remains separate.

The local guard uses `CENTSYS_RELEASE_APPROVED`; the workflow passes the approved input through that environment variable rather than interpolating it into shell code. The publish step uses the artifact built by that workflow. Locally prepared draft archives are review aids and do not replace the provenance-bearing CI artifact.

npm versions are immutable. After an uncertain publish result, inspect the registry before retrying. Keep the previous working tarball/version for rollback and fix regressions in a new version. Never restore an old configuration over unrelated Homebridge changes.
