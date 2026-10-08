# Proposal

## Why

qrcast has its codecs, sender, receiver and demo, but nobody can install it:
the package is at `0.0.0`, there is no release automation, and the claim that
consumer bundlers emit the wasm and worker files is only checked inside this
workspace. Publishing is the last planned change, and shipping an asset layout
that breaks in a consumer's build would be a bad first release.

## What Changes

- Prepare `packages/qrcast` for GitHub Packages and rename it to
  `@thethingteam/qrcast` (GitHub Packages only accepts the owner's scope):
  publish metadata (repository, keywords, `publishConfig` with the registry),
  and a check that the packed tarball holds exactly the files the exports and
  codecs need.
- Add consumer smoke tests in three setups (Vite, webpack, no bundler). Each
  installs the packed tarball into a minimal app, builds it, and checks that the
  wasm and worker files are emitted and load.
- Add CI (typecheck, Node tests, browser tests, smoke tests) on pull requests.
- Add release-please: a release PR with the changelog, starting at `0.1.0`
  with `bump-minor-pre-major`, and `vX.Y.Z` tags.
- Add a publish workflow that runs when release-please creates a release and
  publishes to GitHub Packages with the workflow's built-in `GITHUB_TOKEN`
  (`packages: write`), so there is no stored secret, no OIDC and no
  provenance.
- Document installing and releasing in the README, and remove the planned
  changes that are now captured from `docs/design-notes.md`.
- The name stays scoped, so publishing to the public npm registry later keeps
  the same name and no consumer has to change an import. That later step is not
  part of this change.

## Capabilities

### New Capabilities
- `package-distribution`: what the published `@thethingteam/qrcast` package contains, how a
  consumer's build resolves its assets, and the checks that keep both true.

### Modified Capabilities

None. No existing requirement changes.

## Impact

- `packages/qrcast/package.json` (metadata, scripts), new smoke-test projects
  under a new `smoke/` directory, new `.github/workflows/`, release-please
  config and manifest at the repo root, `README.md`, `docs/design-notes.md`.
- The package name changes from `qrcast` to `@thethingteam/qrcast`, so the demo,
  the smoke tests, the README and the specs that name the package change with
  it. No library source or wire format changes. No runtime dependencies are
  added.
- Consumers need a registry setting and a token with `read:packages` to install
  (GitHub Packages requires it even for public packages), and a package's
  visibility follows its repository's.
- Owner action outside the repo: allow GitHub Actions to create pull requests.
