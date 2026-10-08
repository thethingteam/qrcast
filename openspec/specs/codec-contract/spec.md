# codec-contract Specification

## Purpose

Defines what every codec must report to the qrcast core, and how the core
uses it to apply the codec's compression policy and to refuse payloads that
the codec cannot carry before any encoding starts.

## Requirements

### Requirement: Codec descriptor
Every codec SHALL report a name (a non-empty string such as `cimbar` or `qr`),
a `maxPayloadSize` (a positive integer number of bytes, measured on the
complete envelope), and whether the envelope body is compressed for it.

#### Scenario: Descriptor values are readable
- **WHEN** a caller reads the name, `maxPayloadSize` and compression policy of a codec
- **THEN** each value is available without loading any wasm, worker or other asset

### Requirement: Invalid codec descriptor
Preparing a transfer SHALL fail with `invalid-input` when the codec's name is
not a non-empty string or its `maxPayloadSize` is not a positive safe integer.

#### Scenario: Zero limit
- **WHEN** a transfer is prepared for a codec whose `maxPayloadSize` is 0
- **THEN** it fails with `invalid-input`

### Requirement: Compression follows the codec
When a transfer is prepared, the envelope body SHALL be compressed (under the
envelope's keep-only-when-smaller rule) if and only if the codec asks for
compression.

#### Scenario: Codec without compression
- **WHEN** a body of 10000 zero bytes is prepared for a codec that does not ask for compression
- **THEN** the envelope's flags bit 0 is clear and its body part is the original 10000 bytes

#### Scenario: Codec with compression
- **WHEN** a body of 10000 zero bytes is prepared for a codec that asks for compression
- **THEN** the envelope's flags bit 0 is set

### Requirement: Size check before encoding
After building the envelope and before handing anything to the codec,
preparing a transfer SHALL compare the complete envelope size (after any
compression) with the codec's `maxPayloadSize` and fail with
`payload-too-large` when it is larger, reporting the size, the limit and the
codec name.

#### Scenario: Envelope over the limit
- **WHEN** a body of 2000 random bytes is prepared for a codec named `test` with `maxPayloadSize` 1000
- **THEN** it fails with `payload-too-large` reporting the envelope size, the limit 1000 and the codec `test`, and the codec receives nothing

#### Scenario: Envelope exactly at the limit
- **WHEN** a body is prepared for a codec whose `maxPayloadSize` equals the resulting envelope size
- **THEN** preparing succeeds and returns the envelope

#### Scenario: Compression brings the envelope under the limit
- **WHEN** a body of 10000 zero bytes is prepared for a codec that asks for compression and has `maxPayloadSize` 1000
- **THEN** preparing succeeds, because the limit is checked on the compressed envelope

### Requirement: Assets load only when used
A codec SHALL NOT fetch any wasm, script or worker file until a sender
starts with it or a receiver starts or preloads with it.

#### Scenario: Codec imported but never used
- **WHEN** an app imports a codec entry point, creates the codec and never starts a transfer
- **THEN** none of the codec's asset files is requested

### Requirement: Assets come from the package
By default, a codec SHALL resolve each asset relative to its own module, so
that a bundler that understands `new URL(path, import.meta.url)` copies the
asset into the app's build. The library SHALL NOT request any URL other than
these assets and the overrides the app passes.

#### Scenario: Offline after the first load
- **WHEN** an app has cached its own build, including the emitted codec assets, and runs without network access
- **THEN** a transfer works and no request is made to any host

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
