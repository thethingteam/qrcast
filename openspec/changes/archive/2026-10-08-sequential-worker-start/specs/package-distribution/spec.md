## MODIFIED Requirements

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
