# package-distribution Specification

## Purpose
Defines what the published package contains, that it stays network-free and
works with common bundlers, how it is installed from GitHub Packages, and how
releases are cut and published from CI.

## Requirements

### Requirement: Published package contents
The published `@thethingteam/qrcast` package SHALL contain the built `dist/` files, the
license files, and nothing else the exports do not need. For every subpath
export, the JavaScript and declaration files SHALL exist. For each codec, the
worker script, the glue script, the wasm file and the codec's license files
SHALL sit next to the codec's emitted JavaScript.

#### Scenario: Packed tarball is complete
- **WHEN** the package is packed
- **THEN** every file named by `exports` and every asset a codec references with `new URL('./…', import.meta.url)` is in the tarball

#### Scenario: No stray files
- **WHEN** the package is packed
- **THEN** the tarball holds no test files, vendor sources, local notes or source maps outside `dist/`, apart from `package.json`, the README and the license

### Requirement: Offline and network-free
The package SHALL have no runtime dependencies, SHALL NOT reference a CDN or
any remote URL for code or assets, and SHALL keep each asset reference as a
literal `new URL('./asset', import.meta.url)` so consumer bundlers can emit the
asset.
Caching those assets so that an app works offline SHALL be the consumer app's
job; the package SHALL NOT register a service worker.

#### Scenario: No remote references
- **WHEN** the emitted JavaScript is scanned for `http://` and `https://` URLs used to load code
- **THEN** none is found

#### Scenario: No service worker
- **WHEN** the emitted JavaScript is scanned for service worker registration
- **THEN** none is found, and the README tells consumers to cache the emitted worker scripts, glue scripts and wasm files themselves

#### Scenario: Literal asset references
- **WHEN** a consumer bundler builds an app that imports a codec
- **THEN** the bundler detects each asset reference and emits the file

#### Scenario: Built app works offline
- **WHEN** a minimal Vite app that installs the packed tarball is cached by a service worker in the test, its server is stopped, and the page preloads a receiver with `[cimbar(), qr()]`
- **THEN** the preload resolves without `codec-init-failed`; this check runs in Chromium automatically and in WebKit on request

### Requirement: Consumer bundler support
A consumer app SHALL be able to import `@thethingteam/qrcast/sender`,
`@thethingteam/qrcast/receiver` and a codec, build with Vite or webpack or with no bundler, and have the codec's
wasm and worker files served from the app's own origin. This SHALL be verified
automatically against the packed tarball, not against the workspace sources.

#### Scenario: Vite build
- **WHEN** a minimal Vite app that installs the packed tarball is built
- **THEN** the output contains the cimbar and zxing wasm files and the worker scripts, and the page loads a codec without `codec-init-failed`

#### Scenario: webpack build
- **WHEN** a minimal webpack app that installs the packed tarball is built
- **THEN** the output contains the same files and the page loads a codec without `codec-init-failed`

#### Scenario: No bundler
- **WHEN** a plain `<script type="module">` page imports the installed package from a static server
- **THEN** the relative asset URLs resolve and the page loads a codec without `codec-init-failed`

### Requirement: Installable from GitHub Packages
The package SHALL be named with the owner's scope, `@thethingteam/qrcast`, and
its publish configuration SHALL point at the GitHub Packages registry, so that
a publish run by mistake cannot reach the public npm registry.

#### Scenario: Name and registry
- **WHEN** the package manifest is read
- **THEN** the name is `@thethingteam/qrcast` and `publishConfig.registry` is `https://npm.pkg.github.com`

#### Scenario: Installing
- **WHEN** a consumer sets the registry for the `@thethingteam` scope and a token with `read:packages`, and installs the package
- **THEN** the install succeeds, and the README documents these settings

### Requirement: Automated releases
Releases SHALL be built from Conventional Commits. A release PR SHALL carry the
version bump and changelog, and merging it SHALL create a `vX.Y.Z` tag and
publish that version to GitHub Packages using only the workflow's built-in
token. Before 1.0, a breaking change SHALL bump the minor version.

#### Scenario: Releasing
- **WHEN** a release PR is merged
- **THEN** the tag exists, the same version is listed in GitHub Packages, and the workflow used no secret other than the built-in token

#### Scenario: Checks before publishing
- **WHEN** the publish workflow starts
- **THEN** it builds the package and runs the tests and the packed-tarball check before it publishes, and a failure stops the publish
