# receiver Specification

## Purpose

Defines the browser receiver: how an app turns the frames of a video element
it controls into the transferred bytes, how the receiver detects the codec,
reports progress and returns results, and how it fails.

## Requirements

### Requirement: Creating a receiver
`createReceiver` SHALL take a non-empty list of codecs, an
`HTMLVideoElement` and an optional `acceptRaw` flag (default `false`), and
return a receiver in the `idle` state without loading any asset. An empty
codec list, two codecs with the same name, or a missing video element SHALL
fail with `invalid-input` (reason `option`).

#### Scenario: Creating loads nothing
- **WHEN** an app creates a receiver for the cimbar codec and does not start it
- **THEN** no worker is started and no wasm or script file is requested

#### Scenario: Empty codec list
- **WHEN** `createReceiver` is called with `codecs: []`
- **THEN** it throws `invalid-input` with reason `option`

### Requirement: The app owns the camera
The receiver SHALL only read frames from the video element. It SHALL NOT
request camera access, and SHALL NOT change the element's source, playback
state or attributes. While the element has no current frame, the receiver
SHALL keep waiting without failing.

#### Scenario: Video without data
- **WHEN** `start` is called while the video element has no source
- **THEN** the receiver waits in the `detecting` state, does not fail, and does not call `getUserMedia`

### Requirement: Preloading decoders
`preload()` SHALL load the decoders of every codec and resolve when they are
ready. A later `start` SHALL use the preloaded decoders instead of loading
them again. A load failure SHALL reject with `codec-init-failed`.

#### Scenario: Start after preload
- **WHEN** `preload()` has resolved and `start` is called
- **THEN** the receiver goes to `detecting` without requesting any codec asset again

### Requirement: Receiving a transfer
`start()` SHALL load the decoders if they are not preloaded, read frames
until a codec completes a file, and resolve with the result. The state SHALL
go through `loading` (when loading is needed), `detecting`, `receiving` and
back to `idle`. Calling `start` while a previous `start` is pending SHALL
reject with `invalid-state`.

#### Scenario: Loopback transfer
- **WHEN** a sender plays a 200 KB random body into a canvas whose `captureStream()` feeds the receiver's video element
- **THEN** `start` resolves with `kind` = `qrcast` and `bytes` equal to the sent body byte for byte

#### Scenario: Second start while receiving
- **WHEN** `start` is called while another `start` is pending
- **THEN** the second call rejects with `invalid-state` and the first keeps receiving

### Requirement: Codec detection
While `detecting`, the receiver SHALL hand frames to its codecs in turn. The
first codec that decodes data from a frame SHALL become the locked codec: the
receiver SHALL emit a `lock` event with its name, enter `receiving`, give
every later frame only to that codec and release the other decoders.

#### Scenario: Single codec
- **WHEN** a receiver with only the cimbar codec sees its first decodable cimbar frame
- **THEN** it emits `lock` with codec `cimbar` and the state becomes `receiving`

#### Scenario: Two codecs
- **WHEN** a receiver has codecs A and B and the first frame that either decodes is decoded by B
- **THEN** it locks to B and codec A receives no further frames

#### Scenario: cimbar and QR, QR sender
- **WHEN** a receiver created with `[cimbar(), qr()]` films a QR sender
- **THEN** it emits `lock` with codec `qr` and `start` resolves with the sent body

#### Scenario: cimbar and QR, cimbar sender
- **WHEN** a receiver created with `[cimbar(), qr()]` films a cimbar sender
- **THEN** it emits `lock` with codec `cimbar` and `start` resolves with the sent body

### Requirement: Progress events
While receiving, the receiver SHALL emit `progress` events carrying the
locked codec's name and the fraction of the file received so far, a number
from 0 to 1.

#### Scenario: Progress during a transfer
- **WHEN** a loopback transfer of 200 KB runs to completion
- **THEN** at least one `progress` event arrives before `start` resolves, and every fraction is between 0 and 1

### Requirement: qrcast results
When a codec completes a file that starts with the qrcast magic, the
receiver SHALL unwrap the envelope and resolve with
`{ kind: 'qrcast', meta, bytes }`. When unwrapping fails, `start` SHALL
reject with the envelope error.

#### Scenario: Envelope with hints
- **WHEN** a sender started with hints type `text/plain` and name `a.txt` is received
- **THEN** the result's `meta` is size, type `text/plain` and name `a.txt`

#### Scenario: Unsupported envelope version
- **WHEN** a completed file starts with the qrcast magic followed by version byte `0x02`
- **THEN** `start` rejects with `unsupported-format` and reason `version`

### Requirement: Raw files
When a codec completes a file that does not start with the qrcast magic, the
receiver SHALL reject with `unsupported-format` (reason `magic`) unless
`acceptRaw` is set. With `acceptRaw`, it SHALL resolve with
`{ kind: 'raw', name, bytes }`, where `name` is the file name the codec
carried, or an empty string when there is none.

#### Scenario: Raw file without acceptRaw
- **WHEN** a plain cimbar file is completed by a receiver without `acceptRaw`
- **THEN** `start` rejects with `unsupported-format` and reason `magic`

#### Scenario: Raw file with acceptRaw
- **WHEN** a plain cimbar file named `photo.jpg` is completed by a receiver with `acceptRaw`
- **THEN** `start` resolves with `kind` = `raw`, `name` = `photo.jpg` and the file's bytes

### Requirement: One transfer per start
After `start` settles, the receiver SHALL be `idle` with its decoders
released. The next `start` SHALL use fresh decoder instances.

#### Scenario: Two transfers in a row
- **WHEN** a receiver completes one transfer and `start` is called again while a different body plays
- **THEN** the second `start` resolves with the second body

### Requirement: Stopping and destroying a receiver
`stop()` SHALL stop reading frames, release the decoders, reject a pending
`start` with `cancelled` (reason `stopped`) and return to `idle`. `destroy()`
SHALL do the same with reason `destroyed` and move to `destroyed`, after
which `start` and `preload` SHALL reject with `invalid-state`.

#### Scenario: Stop while receiving
- **WHEN** `stop()` is called while `start` is pending
- **THEN** `start` rejects with `cancelled` and reason `stopped`, and the state is `idle`

#### Scenario: Preload after destroy
- **WHEN** `preload()` is called on a destroyed receiver
- **THEN** it rejects with `invalid-state`

### Requirement: Receiver states and events
A receiver's state SHALL be one of `idle`, `loading`, `detecting`,
`receiving` or `destroyed`, readable at any time, and every change SHALL emit
a `state` event. `on(event, listener)` SHALL return a function that removes
the listener.

#### Scenario: State sequence of a transfer
- **WHEN** a transfer is received without a preload
- **THEN** `state` events report `loading`, `detecting`, `receiving` and `idle` in that order

### Requirement: Failures while receiving
When a decoder fails while `start` is pending, the receiver SHALL release all
decoders, return to `idle` and reject `start` with the error.

#### Scenario: Decoder aborts
- **WHEN** a decoder instance aborts while receiving
- **THEN** `start` rejects with `codec-aborted` and the state is `idle`

### Requirement: Unsupported browser
When the browser lacks a feature a codec needs to receive, `start` and
`preload` SHALL reject with `unsupported-environment` naming the missing
feature, before any codec asset is requested.

#### Scenario: No VideoFrame
- **WHEN** `start` is called in a browser without `VideoFrame`
- **THEN** it rejects with `unsupported-environment` and feature `video-frame`

### Requirement: Safe import outside the browser
Importing the receiver entry point SHALL NOT access browser-only APIs, so
that it can be imported during server-side rendering or in Node.

#### Scenario: Import in Node
- **WHEN** `qrcast/receiver` is imported in Node
- **THEN** the import succeeds
