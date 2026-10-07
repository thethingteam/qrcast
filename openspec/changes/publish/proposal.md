# Proposal

## Why

qrcast has its codecs, sender, receiver and demo, but nobody can install it:
the package is at `0.0.0`, there is no release automation, and the claim that
consumer bundlers emit the wasm and worker files is only checked inside this
workspace. Publishing is the last planned change, and shipping an asset layout
that breaks in a consumer's build would be a bad first release.

## What Changes

- Prepare `packages/qrcast` for the public npm registry: publish metadata
  (repository, keywords, `publishConfig` with provenance), and a check that the
  packed tarball holds exactly the files the exports and codecs need.
- Add consumer smoke tests in three setups (Vite, webpack, no bundler). Each
  installs the packed tarball into a minimal app, builds it, and checks that the
  wasm and worker files are emitted and load.
- Add CI (typecheck, Node tests, browser tests, smoke tests) on pull requests.
- Add release-please: a release PR with the changelog, starting at `0.1.0`
  with `bump-minor-pre-major`, and `vX.Y.Z` tags.
- Add a publish workflow that runs when release-please creates a release and
  publishes with npm trusted publishing (GitHub Actions OIDC, provenance), with
  no stored npm token.
- Document installing and releasing in the README, and remove the planned
  changes that are now captured from `docs/design-notes.md`.
- The owner publishes the current `0.0.0` by hand once, to claim the name,
  because a trusted publisher can only be attached to a package that already
  exists on npm. The first real release, `0.1.0`, then comes from CI.

## Capabilities

### New Capabilities
- `package-distribution`: what the published `qrcast` package contains, how a
  consumer's build resolves its assets, and the checks that keep both true.

### Modified Capabilities

None. No existing requirement changes.

## Impact

- `packages/qrcast/package.json` (metadata, scripts), new smoke-test projects
  under a new `smoke/` directory, new `.github/workflows/`, release-please
  config and manifest at the repo root, `README.md`, `docs/design-notes.md`.
- No library source or wire format changes. No runtime dependencies are added.
- Owner actions outside the repo: reserve and publish `qrcast` on npm, add the
  trusted publisher, and allow GitHub Actions to create pull requests.
