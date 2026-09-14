# Releases

`CHANGELOG.md` is the single source for human-readable release notes. An
approved GitHub Actions run publishes the npm package with provenance, then
creates the matching Git tag and GitHub release from that changelog section.
Stable versions use npm's `latest` tag; `X.Y.Z-alpha.N` uses `alpha`, and
`X.Y.Z-beta.N` uses `beta`.

## Prepare and publish

1. Choose an unused version. Update `version` in `package.json` and
   `package-lock.json`, and set the matching `publishConfig.tag`.
2. Add a dated `## [VERSION]` section to `CHANGELOG.md`. Do not repeat release
   notes in the README or this procedure.
3. Run `npm run check` and `npm pack --dry-run`. Open and merge the reviewed
   change only after CI passes for Node 22, Node 24 and emulated ARMv7.
4. On `main`, manually run **Publish npm release** with `approved_version` set
   to the exact package version, then approve the protected `npm` environment.
5. Confirm the workflow completed both `publish` and `github-release`. The
   latter creates `vVERSION`, marks alpha/beta versions as prereleases and uses
   only the matching changelog section as its notes.

The workflow validates the semver shape, exact approval, npm access, registry,
distribution tag and matching finished changelog section before it publishes.
The approval input never changes files or bumps a version.

## Failure recovery

npm versions are immutable. If publication is uncertain, inspect npm before
trying anything else. If `publish` succeeded but `github-release` failed, use
GitHub's **Re-run failed jobs** action so only the release job runs again; do not
start another publication. The GitHub release job is idempotent for a release
that already targets the same commit and rejects a conflicting tag target.

## One-time release-history alignment

The releases published before automation should be backfilled from the matching
sections of `CHANGELOG.md`. Use these exact publication commits so the source
archives correspond to what npm received:

| Version       | Git target                                 |
| ------------- | ------------------------------------------ |
| 0.1.0-alpha.8 | `8c53857c8b79f5481a6428b8d863b98f7705ae1f` |
| 0.1.0-alpha.9 | `674d4a2ce3f6fe3b981b60c1ebf926b11d34b8d8` |
| 1.0.0         | `d1e3a040473a02c0ae2e7cc44aa8affa4d03052d` |
| 1.1.0         | `120bff718f3f81ebff51a43dcc0c0b6ff12ff238` |

The existing `v0.1.0-alpha.8` draft should be updated with its changelog notes
and published as a prerelease. Create the other three releases from their
targets, using `node scripts/release-notes.mjs VERSION` to extract the notes.
This is a one-time maintainer action; future releases are automatic.

## Publisher configuration

- npm trusted publisher: GitHub owner `deanvanniekerk`, repository
  `homebridge-centsys`, workflow `release.yml`, environment `npm`.
- GitHub environment `npm`: restricted to `main`, with a required maintainer
  review.
- Repository variable `NPM_PUBLISH_ENABLED=true` enables publication.
- The publish job has `contents: read` and `id-token: write`; the subsequent
  GitHub release job has only `contents: write`.

Keep credentials and raw diagnostics out of release artifacts. Hardware
evidence and limitations remain in [validation](VALIDATION.md), not release
notes.
