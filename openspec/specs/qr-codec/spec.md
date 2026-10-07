# qr-codec Specification

## Purpose

Defines the QR codec, the fallback for browsers that cannot run cimbar. It
covers the descriptor and options, how frames are drawn, how a receiver
decodes black and white and color pictures and handles sessions, and its
assets, limits and failures.

## Requirements

### Requirement: qr descriptor
`qr(options)` SHALL return a codec named `qr` whose envelope body is
compressed and whose `maxPayloadSize` is the block size times 5000.
Calling `qr` SHALL NOT load any asset.

#### Scenario: Default descriptor
- **WHEN** an app calls `qr()`
- **THEN** the codec's name is `qr`, its `maxPayloadSize` is 4000000 and its compression policy is on

#### Scenario: Smaller blocks lower the limit
- **WHEN** a sender with `qr({ blockSize: 100 })` starts with a body whose envelope is 500001 bytes after compression
- **THEN** `start` rejects with `payload-too-large`, limit 500000 and codec `qr`

### Requirement: qr options
`layers` SHALL be 1 or 3. `blockSize` SHALL be an integer from 100 to 2000.
`fps` SHALL be a finite number from 1 to 30. `glueUrl` and `wasmUrl` SHALL
be strings or `URL` objects and `workerFactory` a function. Any other value
SHALL fail with `invalid-input` (reason `option`) when `qr` is called.

#### Scenario: Unknown layer count
- **WHEN** `qr({ layers: 2 })` is called
- **THEN** it throws `invalid-input` with reason `option`

#### Scenario: Block size out of range
- **WHEN** `qr({ blockSize: 50 })` is called
- **THEN** it throws `invalid-input` with reason `option`

### Requirement: Sending defaults
When sending, the codec SHALL use one layer, 800-byte blocks and 15 frames
per second unless the options say otherwise.

#### Scenario: Default sender settings
- **WHEN** a sender is created with `qr()` and started
- **THEN** it shows black and white pictures at about 15 frames per second, and each frame's payload is 800 bytes

### Requirement: QR symbols
The sender SHALL encode each frame as a QR code in alphanumeric mode with
error correction level L. All QR codes of one transfer SHALL use the same
version, which is the smallest version that holds the longest frame text the
transfer can produce.

#### Scenario: Version is stable during a transfer
- **WHEN** a transfer plays through its first pass and into the second, where repair indexes need more base36 digits
- **THEN** every picture decodes as QR codes of the same version

### Requirement: Picture size
Every picture of a transfer SHALL have the same pixel size. Each module
SHALL cover the same whole number of pixels, with a white quiet zone of at
least 4 modules. The sender SHALL choose the largest module size that keeps
the picture at most 1024 pixels wide, and at least 1 pixel.

#### Scenario: Canvas size during a transfer
- **WHEN** a QR transfer plays for two seconds
- **THEN** the canvas `width` and `height` are equal, at most 1024, and unchanged from the first frame

### Requirement: Sending needs no assets
Sending with the QR codec SHALL NOT start a worker or request any wasm or
script file, and SHALL NOT require WebGL or WebAssembly.

#### Scenario: Sender without WebAssembly
- **WHEN** a QR sender starts in a browser without `WebAssembly`
- **THEN** the first frame is drawn and no codec asset is requested

### Requirement: Required browser features for receiving
Receiving SHALL require Web Workers, WebAssembly and `VideoFrame`. A missing
feature SHALL be reported as `unsupported-environment` with feature
`worker`, `webassembly` or `video-frame`.

#### Scenario: Receiving without WebAssembly
- **WHEN** a receiver with the QR codec starts in a browser without `WebAssembly`
- **THEN** it rejects with `unsupported-environment` and feature `webassembly`

### Requirement: Color detection per capture
The receiver SHALL decide for each capture whether it is color, from the
average saturation of its central region. Below the threshold it SHALL
decode the capture once in grayscale; otherwise it SHALL decode the red,
green and blue channels separately, and a failure in one channel SHALL NOT
affect the others. The receiving codec ignores `layers`.

#### Scenario: Color sender
- **WHEN** a sender with `qr({ layers: 3 })` plays into a receiver with `qr()`
- **THEN** the transfer completes byte for byte

#### Scenario: Black and white sender
- **WHEN** a sender with `qr({ layers: 1 })` plays into a receiver with `qr({ layers: 3 })`
- **THEN** the transfer completes byte for byte

### Requirement: Locking on the first frame
The QR codec SHALL report data, so that the receiver locks to it, when it
reads its first valid frame. QR codes that are not valid frames SHALL NOT
lock it.

#### Scenario: Unrelated QR code
- **WHEN** a receiver with `[cimbar(), qr()]` films a QR code whose text is `https://example.com/`
- **THEN** it stays in `detecting` and emits no `lock` event

### Requirement: Sessions
The receiver SHALL decode up to two sessions at once. When a frame of a
third session arrives, it SHALL drop the session that gained information
least recently. The first session to pass its integrity check SHALL be the
received file.

#### Scenario: Sender restarts with new bytes
- **WHEN** a QR sender starts body A, the receiver locks and makes progress, and the sender then starts body B
- **THEN** the receiver's `start` resolves with body B without being restarted

### Requirement: Failed integrity check
When a session's rebuilt data does not match its `CRC32`, the receiver SHALL
discard that session's progress and keep decoding later frames, without
failing the transfer.

#### Scenario: Corrupted session
- **WHEN** every block of a session is determined but the rebuilt data does not match its `CRC32`
- **THEN** the session starts again from no blocks, `start` stays pending, and later frames of that session can still complete it

### Requirement: QR progress
The progress fraction SHALL be the number of independent equations the
session holds divided by `TOTAL`, for the session that gained information
most recently. It SHALL be 1 only when every block is determined.

#### Scenario: Half of the source frames
- **WHEN** a receiver of a 100-block session has read source frames 0 to 49 and nothing else
- **THEN** the last progress fraction it reported is 0.5

### Requirement: No file name
The QR codec SHALL NOT carry a file name. A completed file without the qrcast
magic SHALL be reported with the name `''`.

#### Scenario: Raw data over QR
- **WHEN** a receiver with `acceptRaw` completes QR frames whose data does not start with the qrcast magic
- **THEN** `start` resolves with `kind` = `raw`, `name` = `''` and the data

### Requirement: Decoder workers
Receiving SHALL decode QR codes in workers, never on the main thread. Each
receiver transfer SHALL use workers that no earlier transfer used, and
ending the transfer (by stop, completion or failure) SHALL terminate them.

#### Scenario: Workers end with the transfer
- **WHEN** a QR transfer completes
- **THEN** every worker the codec started for it has been terminated

### Requirement: Decoder aborts
When a decoder worker fails after it has loaded, the codec SHALL report
`codec-aborted` with codec `qr`, role `receiver` and the last progress
fraction (or `null` before any progress).

#### Scenario: Worker crashes while receiving
- **WHEN** the decoder worker throws an uncaught error after reporting a progress of 0.25
- **THEN** `start` rejects with `codec-aborted`, codec `qr`, role `receiver` and progress 0.25

### Requirement: Load failures
When the worker cannot start, or the zxing script or wasm cannot be loaded or
instantiated, the codec SHALL fail with `codec-init-failed` for codec `qr`,
keeping the underlying error as `cause` when there is one.

#### Scenario: Missing wasm
- **WHEN** the codec is created with a `wasmUrl` that returns 404 and a receiver starts
- **THEN** it rejects with `codec-init-failed` and codec `qr`

### Requirement: zxing loads from the package
The receiver SHALL load the zxing script and wasm only from the package's own
assets or the URLs the app passes. It SHALL NOT request zxing-wasm's default
CDN or any other host.

#### Scenario: No CDN request
- **WHEN** a QR transfer is received with the default options
- **THEN** no request goes to `cdn.jsdelivr.net` or to any origin other than the page's

### Requirement: Bundled zxing files
The package SHALL ship the zxing-wasm v3.1.4 reader IIFE script and reader
wasm byte for byte as published on npm, with the zxing-wasm license (MIT)
and the zxing-cpp license (Apache-2.0) next to them.

#### Scenario: Files match the release
- **WHEN** the SHA-256 digests of the packaged zxing script and wasm are computed
- **THEN** they equal the digests of `dist/iife/reader/index.js` and `dist/reader/zxing_reader.wasm` in the zxing-wasm 3.1.4 npm package
