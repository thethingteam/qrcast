# sender Specification

## Purpose

Defines the browser sender: how an app turns a `Uint8Array` into an animated
code sequence drawn into a canvas it owns, and how the sender reports its
state, its frames and its failures, whatever the codec.

## Requirements

### Requirement: Creating a sender
`createSender` SHALL take a codec and an `HTMLCanvasElement` and return a
sender in the `idle` state. Creating a sender SHALL NOT load any asset or
start any worker. A missing canvas or a value that is not a qrcast codec
SHALL fail with `invalid-input` (reason `option`).

#### Scenario: Creating loads nothing
- **WHEN** an app creates a sender for the cimbar codec and does not start it
- **THEN** no worker is started and no wasm or script file is requested

#### Scenario: Missing canvas
- **WHEN** `createSender` is called without a canvas
- **THEN** it throws `invalid-input` with reason `option`

### Requirement: Size check before loading
`start` SHALL build the envelope and run the codec's size check before it
loads any codec asset. When the check fails, `start` SHALL reject with that
error, load nothing, and leave the canvas and the state unchanged.

#### Scenario: Oversized payload loads nothing
- **WHEN** `start` is called with a body whose envelope is larger than the codec's `maxPayloadSize`
- **THEN** it rejects with `payload-too-large`, no codec asset is requested, and the state stays `idle`

#### Scenario: Invalid hint
- **WHEN** `start` is called with a `name` hint that is not a string
- **THEN** it rejects with `invalid-input` (reason `meta-field`) before any asset is requested

### Requirement: Starting a transfer
`start(bytes, hints)` SHALL load the codec, encode the envelope and resolve
once the first frame is drawn on the canvas, with the sender in the `playing`
state. The sender SHALL set the canvas's pixel size (`width` and `height`) to
the codec's frame size and SHALL NOT change the canvas's style or position.

#### Scenario: First frame
- **WHEN** `start` resolves
- **THEN** the canvas shows a code frame, its `width` and `height` equal the codec's frame size, its `style` attribute is unchanged, and the state is `playing`

### Requirement: Frame pacing and frame events
While playing, the sender SHALL show a new frame at the codec's frame rate
and SHALL emit a `frame` event for each frame shown, carrying the number of
frames shown since this transfer started (the first frame is 1).

#### Scenario: Frame count
- **WHEN** a transfer plays at 15 frames per second for about two seconds
- **THEN** the `frame` events carry the counts 1, 2, 3 and so on without gaps, and about 30 of them have been emitted

### Requirement: Restarting replaces the transfer
Calling `start` while a transfer is loading or playing SHALL end that
transfer and start the new one with a fresh codec instance. A pending `start`
that is replaced SHALL reject with `cancelled` (reason `stopped`).

#### Scenario: Start while playing
- **WHEN** `start` is called with new bytes while a transfer is playing
- **THEN** the new transfer plays from frame count 1 and the old one shows no more frames

### Requirement: Stopping a transfer
`stop()` SHALL end the current transfer, release its codec instance, clear
the canvas and return the sender to `idle`. After `stop`, no `frame` event
SHALL be emitted until the next `start`. Stopping while `start` is pending
SHALL reject that `start` with `cancelled` (reason `stopped`).

#### Scenario: Stop while playing
- **WHEN** `stop()` is called while a transfer is playing
- **THEN** the state becomes `idle`, the canvas is cleared, and no more `frame` events arrive

#### Scenario: Stop while loading
- **WHEN** `stop()` is called before a pending `start` resolves
- **THEN** that `start` rejects with `cancelled` and reason `stopped`

### Requirement: Destroying a sender
`destroy()` SHALL stop any transfer and move the sender to the `destroyed`
state. A pending `start` SHALL reject with `cancelled` (reason `destroyed`).
Any later `start` SHALL reject with `invalid-state`. Calling `stop` or
`destroy` again SHALL do nothing.

#### Scenario: Start after destroy
- **WHEN** `start` is called on a destroyed sender
- **THEN** it rejects with `invalid-state` and the state stays `destroyed`

### Requirement: Sender states and events
A sender's state SHALL be one of `idle`, `loading`, `playing` or
`destroyed`, readable at any time, and every change SHALL emit a `state`
event. `on(event, listener)` SHALL return a function that removes the
listener.

#### Scenario: State sequence of a transfer
- **WHEN** a transfer is started and later stopped
- **THEN** `state` events report `loading`, `playing` and `idle` in that order

#### Scenario: Removing a listener
- **WHEN** an app calls the function returned by `on('frame', listener)`
- **THEN** that listener receives no further `frame` events

### Requirement: Failures while playing
When the codec fails after `start` has resolved, the sender SHALL emit an
`error` event with the `QrcastError`, stop showing frames and return to
`idle`.

#### Scenario: Codec aborts while playing
- **WHEN** the codec instance aborts during playback
- **THEN** an `error` event carries a `codec-aborted` error and the state becomes `idle`

### Requirement: Unsupported browser
When the browser lacks a feature the codec needs to send, `start` SHALL
reject with `unsupported-environment` naming the missing feature, before any
codec asset is requested.

#### Scenario: No WebGL in workers
- **WHEN** `start` is called for the cimbar codec in a browser that cannot create a WebGL context on an `OffscreenCanvas`
- **THEN** it rejects with `unsupported-environment` and feature `webgl`

### Requirement: No side effects on the page
The sender SHALL NOT add elements to the document, define global variables,
or listen to keyboard, pointer or focus events on the page.

#### Scenario: Typing while a transfer plays
- **WHEN** a transfer is playing and the user presses Backspace or Tab in a text field on the same page
- **THEN** the text field deletes the character or the focus moves, as it would without qrcast

### Requirement: Safe import outside the browser
Importing the sender entry point SHALL NOT access browser-only APIs, so that
it can be imported during server-side rendering or in Node.

#### Scenario: Import in Node
- **WHEN** `qrcast/sender` is imported in Node
- **THEN** the import succeeds
