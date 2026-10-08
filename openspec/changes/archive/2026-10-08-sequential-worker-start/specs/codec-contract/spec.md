## ADDED Requirements

### Requirement: Workers start one at a time
On a page, qrcast SHALL have at most one codec worker starting at a time, for
all codecs, senders and receivers together. A worker counts as starting from
its creation until it answers its first message (ready or a failure), fails
to load, times out, or could not be created. The next worker SHALL be created
only after that.

#### Scenario: Receiver with cimbar and QR
- **WHEN** a receiver with `[cimbar(), qr()]` preloads
- **THEN** each worker is created only after every worker created before it has answered its first message

#### Scenario: A worker fails to start
- **WHEN** a worker answers its first message with a failure
- **THEN** the next waiting worker is created, and the failing load rejects with `codec-init-failed`

#### Scenario: Offline in WebKit
- **WHEN** a page controlled by a service worker that caches the app's build, including the codec assets, preloads a receiver with `[cimbar(), qr()]` in WebKit without network access
- **THEN** the preload resolves without `codec-init-failed`

### Requirement: Loading stops early
A codec SHALL NOT create a worker for a sender or receiver after that sender
or receiver was stopped or destroyed, including a worker still waiting for
its turn, and SHALL end the workers it already started for it. A codec that
starts several workers SHALL NOT create further ones once one has failed to
start.

#### Scenario: First cimbar worker fails
- **WHEN** the first worker of a cimbar receiver fails to start
- **THEN** no other cimbar worker is created, and the load rejects with `codec-init-failed`

#### Scenario: Stopped while loading
- **WHEN** a receiver with `[cimbar(), qr()]` is stopped while its workers are still starting
- **THEN** no worker is created after the stop, and the workers already created are ended

## MODIFIED Requirements

### Requirement: Asset location overrides
A codec that loads assets SHALL accept options that replace the default
asset URLs and a `workerFactory` function that creates its workers, and
SHALL use them instead of the defaults when given. qrcast SHALL use only
`onmessage`, `onerror`, `onmessageerror`, `postMessage` and `terminate` of
the object the factory returns, so the factory may return a wrapper.

#### Scenario: Custom worker factory
- **WHEN** a codec is created with a `workerFactory` and a transfer starts
- **THEN** every worker the codec uses comes from that factory

#### Scenario: Wrapper with only the documented members
- **WHEN** a `workerFactory` returns an object that forwards only `onmessage`, `onerror`, `onmessageerror`, `postMessage` and `terminate` to a real worker
- **THEN** a transfer completes as with a real worker
