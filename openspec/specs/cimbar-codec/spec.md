# cimbar-codec Specification

## Purpose

Defines the cimbar codec, the default qrcast codec built on the official
libcimbar release: its descriptor and options, its modes and limits, how its
wasm instances live and die, and its compatibility with plain cimbar.

## Requirements

### Requirement: cimbar descriptor
`cimbar(options)` SHALL return a codec named `cimbar` whose `maxPayloadSize`
is 16777216 bytes (16 MiB) and whose envelope body is never compressed,
whatever the mode. Calling `cimbar` SHALL NOT load any asset.

#### Scenario: Descriptor values
- **WHEN** an app calls `cimbar({ mode: 'Bm' })`
- **THEN** the codec's name is `cimbar`, its `maxPayloadSize` is 16777216 and its compression policy is off

#### Scenario: Body is sent uncompressed
- **WHEN** a body of 100000 zero bytes is sent with the cimbar codec and received
- **THEN** the received envelope's flags bit 0 was clear

### Requirement: cimbar options
`mode` SHALL be one of `B`, `Bm`, `Bu` or `4C`. `fps` SHALL be a finite
number from 1 to 30. `glueUrl` and `wasmUrl` SHALL be strings or `URL`
objects and `workerFactory` a function. Any other value for these options
SHALL fail with `invalid-input` (reason `option`) when `cimbar` is called.

#### Scenario: Unknown mode
- **WHEN** `cimbar({ mode: '8C' })` is called
- **THEN** it throws `invalid-input` with reason `option`

#### Scenario: Frame rate out of range
- **WHEN** `cimbar({ fps: 0 })` is called
- **THEN** it throws `invalid-input` with reason `option`

### Requirement: Sending defaults
When sending, the codec SHALL use mode `B` and 15 frames per second unless
the options say otherwise.

#### Scenario: Default sender settings
- **WHEN** a sender is created with `cimbar()` and started
- **THEN** it encodes in mode B and shows about 15 frames per second

### Requirement: Receiving modes
When receiving, a codec created without `mode` SHALL try modes B, Bm, Bu and
4C until one decodes and then keep that mode. A codec created with `mode`
SHALL try only that mode.

#### Scenario: Automatic mode
- **WHEN** a sender plays in mode 4C and the receiver's codec was created without `mode`
- **THEN** the transfer completes

#### Scenario: Fixed mode mismatch
- **WHEN** a sender plays in mode 4C and the receiver's codec was created with mode `B`
- **THEN** the receiver never locks

### Requirement: Compatibility with plain cimbar
The codec SHALL send each transfer as one cimbar file, readable by the
official libcimbar v0.6.8 receiver, whose content is the qrcast envelope and
whose file name is `qrcast.bin`. When receiving, it SHALL decode files sent
by the official libcimbar v0.6.8 sender and pass on the file name they carry.

#### Scenario: Official receiver
- **WHEN** a qrcast cimbar transfer is scanned by the official cimbar web receiver
- **THEN** it saves a file named `qrcast.bin` whose bytes are the envelope

#### Scenario: Official sender
- **WHEN** the official cimbar web sender plays a file named `photo.jpg` to a receiver with `acceptRaw`
- **THEN** the result is `kind` = `raw`, `name` = `photo.jpg` and the file's bytes

### Requirement: Fresh instances per transfer
Each sender transfer and each receiver transfer SHALL use wasm instances
that no earlier transfer used. Ending a transfer (by stop, restart,
completion or failure) SHALL release its instances.

#### Scenario: Large transfers back to back
- **WHEN** one sender starts a 15 MiB random body, and after its first frame starts a different 15 MiB random body
- **THEN** both starts resolve

### Requirement: Aborted instances
When a cimbar wasm instance aborts or throws, the codec SHALL report
`codec-aborted` and SHALL NOT call that instance again. For a sender the
details SHALL carry the envelope size; for a receiver, the last progress
fraction (or `null` before any progress).

#### Scenario: Abort while sending
- **WHEN** the encoder instance aborts while playing a 1000000-byte envelope
- **THEN** the sender emits `codec-aborted` with codec `cimbar`, role `sender` and size 1000000, and shows no more frames

### Requirement: Load failures
When the worker cannot start or the cimbar script or wasm cannot be loaded or
instantiated, the codec SHALL fail with `codec-init-failed` for codec
`cimbar`, keeping the underlying error as `cause` when there is one.

#### Scenario: Missing wasm
- **WHEN** the codec is created with a `wasmUrl` that returns 404 and a transfer starts
- **THEN** it fails with `codec-init-failed` and codec `cimbar`

### Requirement: Required browser features
Sending SHALL require Web Workers, WebAssembly and WebGL on an
`OffscreenCanvas`. Receiving SHALL require Web Workers, WebAssembly and
`VideoFrame`. A missing feature SHALL be reported as
`unsupported-environment` with feature `worker`, `webassembly`, `webgl` or
`video-frame`.

#### Scenario: Receiving without WebAssembly
- **WHEN** a receiver with the cimbar codec starts in a browser without `WebAssembly`
- **THEN** it rejects with `unsupported-environment` and feature `webassembly`

### Requirement: Bundled libcimbar files
The package SHALL ship the libcimbar v0.6.8 glue script and wasm byte for
byte as published in the official release, with the MPL-2.0 license text
next to them.

#### Scenario: Files match the release
- **WHEN** the SHA-256 digests of the packaged glue script and wasm are computed
- **THEN** they equal the digests of the same files in the official v0.6.8 `cimbar.wasm.tar.gz`
