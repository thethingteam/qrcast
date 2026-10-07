# Proposal

## Why

The core byte protocol is in place, but nothing can send or receive bytes
yet. cimbar is the default codec and roughly three times faster than color QR
on a real phone, so it comes first. The sender and receiver APIs get their
shape here, from a working codec, instead of being guessed in the abstract.

## What Changes

- Add the sender (`qrcast/sender`):
  - `createSender({ codec, canvas })` plays an animated transfer into a
    canvas that the app owns and places.
  - `start(bytes, hints)` builds the envelope, runs the size check, loads the
    codec, and resolves once the first frame is on screen. Calling `start`
    again replaces the current transfer. `stop()` ends the transfer and
    `destroy()` releases everything.
  - Events: `state`, `frame` and `error`.
- Add the receiver (`qrcast/receiver`):
  - `createReceiver({ codecs, video, acceptRaw })` reads frames from a
    `<video>` element that the app fills. The app opens the camera; the
    library never calls `getUserMedia`.
  - `start()` resolves with the received payload, and `preload()` loads the
    decoders ahead of time.
  - Detection: the receiver alternates its codecs until the first successful
    decode, then locks to that codec.
  - Events: `state`, `lock` and `progress`.
  - The result is `{ kind: 'qrcast', meta, bytes }`. With `acceptRaw`, a plain
    cimbar file without a qrcast envelope comes back as
    `{ kind: 'raw', name, bytes }`; without it, such a file fails with
    `unsupported-format`.
- Add the cimbar codec (`qrcast/cimbar`):
  - `cimbar({ mode, fps })` is a lightweight descriptor: name `cimbar`,
    `maxPayloadSize` 16 MiB, no envelope compression.
  - It wraps the unmodified official libcimbar v0.6.8 wasm release (MPL-2.0),
    which is shipped next to the emitted JavaScript together with its license.
  - Encoding and decoding run in classic workers. Each transfer gets fresh
    wasm instances.
  - It supports modes B (default), Bm, Bu and 4C, and the receiver detects
    the mode automatically.
  - Escape hatches: `glueUrl`, `wasmUrl` and `workerFactory`.
- Add error codes: `unsupported-environment`, `codec-init-failed`,
  `codec-aborted`, `cancelled` and `invalid-state`. `invalid-input` gains the
  reason `option`.
- Add the first browser tests: Vitest browser mode with Playwright Chromium,
  running a digital loopback (sender canvas → `captureStream()` → receiver).
- Add `apps/demo`, a private, unstyled Vite app with a send page and a
  receive page for manual tests on real devices. It is also the first
  consumer build that checks the asset emission.

Out of scope:

- The QR codec.
- Multi-segment transfers.
- Sending raw files (without an envelope) to official cimbar receivers.
- A name sanitizing helper and screen wake lock (app concerns).
- Deploying the demo, consumer smoke tests for webpack and no bundler,
  release-please and CI (all in the `publish` change).
- Building libcimbar from source.

## Capabilities

### New Capabilities

- `sender`: the browser sender API, its lifecycle, events and canvas output,
  independent of the codec.
- `receiver`: the browser receiver API, its lifecycle, events, codec
  detection, and how received files become results (including `acceptRaw`).
- `cimbar-codec`: the cimbar codec's descriptor, options, modes, limits,
  wasm instance lifecycle and abort handling.

### Modified Capabilities

- `codec-contract`: codecs load their assets only when used, resolve them
  from the package itself (never a network origin of their own choosing), and
  honor the asset location overrides.
- `error-model`: new codes `unsupported-environment`, `codec-init-failed`,
  `codec-aborted`, `cancelled` and `invalid-state` with their details, and
  the new `invalid-input` reason `option`.

## Impact

- New public entry points `qrcast/sender`, `qrcast/receiver` and
  `qrcast/cimbar` in the package `exports`. The package root keeps exporting
  only the core.
- New package contents: the vendored libcimbar files (glue script, wasm,
  MPL-2.0 license) and a qrcast classic worker script, copied into
  `dist/codecs/cimbar/` by a build step that follows `tsc`.
- Consumers' bundlers emit about 2 MB of assets (1.94 MB wasm) when they
  import `qrcast/cimbar`. The wasm is fetched only when a cimbar transfer
  starts or preloads. Vite users must exclude `qrcast` from dependency
  pre-bundling in dev; the README says so.
- New development dependencies: `@vitest/browser`, Playwright (Chromium
  download), and Vite for the demo.
- `docs/design-notes.md`: sections 5.1, 8, 9 and 10 are trimmed once the
  specs are archived.
