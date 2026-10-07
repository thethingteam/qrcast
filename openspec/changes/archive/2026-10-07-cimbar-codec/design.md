# Design

## Context

See proposal.md for the motivation. The starting point:

- `core-byte-protocol` provides `prepareTransfer` (envelope plus size check),
  `unwrapEnvelope`, the `CodecDescriptor` shape and `QrcastError`. The
  package root exports only types and `QrcastError`.
- A private prototype already sends and receives cimbar in a web page with
  the official libcimbar v0.6.8 wasm release, on the main thread. Its
  findings are in `docs/design-notes.md` sections 5.1 and 7. The facts that
  shape this design are below.
- The release has three files:
  - `cimbar_js.<stamp>.js`: an emscripten classic script with a global
    `Module`.
  - `cimbar_js.<stamp>.wasm`: 1.94 MB, with a fixed 128 MB heap.
  - `recv-worker.<stamp>.js`: it hard-codes `importScripts` of the glue's
    file name.
- The glue renders through emscripten's GLFW, which touches `window` and
  `document`. It contains no OffscreenCanvas support. Rendering in a worker
  was never tried.
- Encode calls:
  - `cimbare_configure(mode, -1)`, `cimbare_init_window`,
    `cimbare_init_encode(name, -1)`.
  - `cimbare_encode` in chunks, then a zero-length call when the last call
    returned 1.
  - Per frame: `cimbare_render` and `cimbare_next_frame(false)`.
- Decode calls:
  - Per frame: `cimbard_scan_extract_decode` on NV12, I420 or RGBA pixels.
    It returns fountain bytes.
  - `cimbard_fountain_decode` returns a BigInt: more than 0 means done (the
    low 32 bits are the file id), 0 means not yet, below 0 is an error.
  - `cimbard_get_report` gives a JSON array of per-file progress fractions.
  - Then `cimbard_get_filename` and `cimbard_decompress_read` in chunks until
    a call returns 0 or less.
- `configure` only updates cimbar's global config when the mode differs from
  the one it remembers. This matters only when one instance is reused, and
  this design never reuses one.
- Decided constraints this design must honor (design notes 5.1 and 10):
  - Classic workers.
  - Assets referenced with literal `new URL(..., import.meta.url)`.
  - No CDN and no `blob:` workers.
  - Plain `tsc` plus an asset copy step.
  - cimbar loaded by dynamic import.
  - A fresh instance per transfer.

## Goals / Non-Goals

**Goals:**

- A codec-agnostic sender and receiver core, so that `qr-codec` only adds a
  codec driver.
- Work that cimbar does stays off the main thread, on both sides.
- Every promise settles: with a result, a `QrcastError`, or `cancelled`.

**Non-Goals:**

- A public codec plug-in API. The driver interface stays internal, and
  `createSender` and `createReceiver` accept only qrcast's own codecs.
- Caching compiled wasm across transfers. It can come later without changing
  the specs.
- Tuning for phones beyond a conservative worker count.

## Decisions

### Package layout and exports

```
packages/qrcast/
  vendor/cimbar/            unmodified release files + LICENSE + README (sha256)
  src/
    index.ts                core (unchanged exports, plus new types)
    sender/index.ts         createSender
    receiver/index.ts       createReceiver
    states.ts               SenderState, ReceiverState
    internal/               emitter, codec driver types, env probes
    codecs/cimbar/
      index.ts              cimbar(): validated descriptor, no assets
      options.ts            option validation, mode numbers
      runtime.ts            asset URLs, worker start and protocol
      sender-driver.ts      encoder worker client (dynamic-import target)
      receiver-driver.ts    extract pool + assembler (dynamic-import target)
      cimbar-worker.js      hand-written classic worker (checked with checkJs)
      worker-globals.d.ts   the worker's globals, for tsconfig.worker.json
  scripts/copy-assets.mjs   copies vendor/cimbar/* and cimbar-worker.js
                            to dist/codecs/cimbar/
```

The `exports` map gets `./sender`, `./receiver` and `./cimbar` next to `.`.
The worker is plain JavaScript because it must stay a classic script. `tsc`
emits files of a `type: module` package as modules, so a TypeScript worker
would need a second build. `checkJs` with a small `.d.ts` for the cimbar
`Module` still type-checks it, under its own `tsconfig.worker.json` (the
WebWorker lib), which `pnpm typecheck` runs.

### Internal codec drivers

`cimbar()` returns a frozen object with the public descriptor fields (`name`,
`maxPayloadSize`, `compress`) plus the internal factories for each role,
keyed by a module-private symbol. Those factories dynamically import the
driver modules, which import `runtime.ts`, so the asset references load only
with a transfer. `createSender` and `createReceiver` reject anything without
that symbol with `invalid-input` (reason `option`).

The drivers:

- Sender: `start(envelope)` (load and encode), `nextFrame(): ImageBitmap`,
  `fps` and `dispose()`, with an `onFailure` callback.
- Receiver: `load()`, `canAccept()`, `push(frame)`, and the callbacks
  `onData` (the first decoded bytes; used for locking), `onProgress`,
  `onFile(bytes, name)` and `onFailure`, plus `dispose()`.

The core owns states, events, the size check, detection, unwrapping and
`acceptRaw`. `qr-codec` will add drivers and touch nothing else.

The alternative was to make the driver interface public now. It was
rejected because one codec is not enough to know its right shape, and
pre-1.0 we can still widen it.

### Loading the worker and the cimbar files

`runtime.ts` holds the literal asset references:

```ts
const workerUrl = new URL('./cimbar-worker.js', import.meta.url);
const glueUrl = new URL('./cimbar_js.2026-08-21T2336.js', import.meta.url);
const wasmUrl = new URL('./cimbar_js.2026-08-21T2336.wasm', import.meta.url);
```

How the files are used:

- The worker is created with `new Worker(workerUrl)`. The URL goes through a
  variable, not the `new Worker(new URL(...))` pattern, so bundlers emit the
  file as an asset as-is instead of re-bundling a classic script.
- The first message gives the worker its role, `glueUrl` and `wasmUrl`. The
  worker sets `Module.locateFile` to return `wasmUrl`, sets `onAbort`, then
  calls `importScripts(glueUrl)`.
- Hashed file names in the app's build therefore do not matter.
- `glueUrl`, `wasmUrl` and `workerFactory` options replace these defaults.

Rejected alternatives:

- The official `recv-worker`: its hard-coded `importScripts` name breaks as
  soon as a bundler hashes or moves the glue.
- Injecting the glue as a `<script>` on the main thread, as the prototype
  does:
  - It defines globals.
  - GLFW grabs Backspace and Tab page-wide.
  - Only one instance can exist per page, which breaks "fresh instance per
    transfer".

The vendored files keep their release names, so their digests can be
compared with the release directly.

### Encoder in a worker, frames out as ImageBitmap

The encoder worker owns an `OffscreenCanvas`:

- GLFW is pointed at it through `Module.canvas`.
- Three stand-ins, the same as the official `send-worker` uses:
  `self.window = self`, a `matchMedia` that returns an inert query, and a
  `document` object with no-op listener methods. The glue aborts without
  any one of them.

For each frame the worker calls `cimbare_render` and `cimbare_next_frame`,
then `transferToImageBitmap()`, and posts the bitmap (transferred, not
copied). `cimbare_render` draws the frame that the previous
`cimbare_next_frame` prepared, so the worker calls `cimbare_next_frame`
once after encoding; otherwise the first bitmap is blank.

The main thread draws into the app's canvas through a `bitmaprenderer`
context:

- `createSender` acquires that context. If the canvas already has another
  context type, this fails with `invalid-input` (reason `option`).
- The canvas `width` and `height` are set to the bitmap size.
- Stopping clears the canvas with `transferFromImageBitmap(null)`.

Why not `transferControlToOffscreen` on the app's canvas: control can be
transferred only once per canvas, and every transfer needs a new worker.
With bitmaps the app's canvas stays the same element for the sender's whole
life.

The spike (task 1) confirmed this path in headless Chromium with
SwiftShader WebGL: GLFW creates a 1040 × 1040 window on the
`OffscreenCanvas` in mode B, the bitmaps are distinct cimbar frames, and a
200 KB body decodes back byte for byte (27 frames) through separate extract
and assemble instances. The official release also ships a `send-worker`
that renders the encoder in a worker, so this is a path upstream supports.

### Frame pacing

The main thread runs `requestAnimationFrame` with an accumulated deadline of
`1000 / fps` and a 2 ms tolerance, so that 15 fps holds on 60 Hz displays.
The prototype measured this.

The worker keeps one frame rendered ahead. At each deadline the main thread
shows the ready bitmap, emits `frame`, and requests the next one. Hidden
tabs pause naturally, because rAF stops firing.

### Receiver pipeline

1. **Capture.** `requestVideoFrameCallback`, falling back to rAF, gives
   frames. Each one becomes a `VideoFrame` and is copied out with `copyTo`:
   native NV12 or I420 when the frame has that format, RGBA otherwise.
2. **Extract.** The pixel buffer is transferred round-robin to N extract
   workers:
   - N = `clamp(hardwareConcurrency - 1, 1, 3)`.
   - At most 2 frames are in flight per worker; a capture that finds every
     worker busy is skipped.
   - Each worker runs `cimbard_scan_extract_decode` and returns the fountain
     bytes and the mode it used.
3. **Assemble.** The main thread forwards the bytes to one assembler worker.
   - It runs `cimbard_fountain_decode` and posts progress from
     `cimbard_get_report`.
   - On completion it reads the name and the file in
     `cimbard_get_decompress_bufsize` chunks, and transfers the result back.
   - A separate instance means the assembler's 128 MB heap holds only the
     file.
4. **Modes.** Without a fixed mode, extract workers rotate B, Bm, Bu and 4C
   per frame. The first mode that yields bytes is locked for all workers and
   configured on the assembler.
5. **Codec detection.** This lives in the core: while `detecting`, frames go
   to the codec drivers in turn. The first `onData` locks that codec, and
   the core disposes the other drivers.

Instances: at most 4 cimbar instances (3 extract + 1 assemble) per receive.
The prototype ran 5 on an iPhone.

### Instance lifecycle and failures

Every transfer creates its workers and terminates them when it ends (stop,
restart, completion or failure). `receiver.preload()` creates the set for
the next `start` only.

Inside the worker:

- `onAbort`, and any exception from a cimbar call, posts `aborted` and stops
  handling messages.
- On the main thread, a worker `error` event counts as an abort after
  `ready`, and as an init failure before it.

`codec-init-failed` covers:

- `importScripts` failing,
- the wasm fetch or instantiation failing,
- the worker failing to start, and
- `ready` not arriving within 30 s.

### Environment probes

Probes run before any asset is requested:

- `typeof Worker`,
- `typeof WebAssembly`,
- `typeof VideoFrame` (receive), and
- WebGL: `new OffscreenCanvas(1, 1).getContext('webgl2') ?? getContext('webgl')`
  (send).

The WebGL probe runs on the main thread. That is a proxy for the worker, and
a mismatch would surface as `codec-init-failed`.

### Events and promises

A small typed emitter is used (not `EventTarget`), so that listeners get
typed payloads. A listener that throws is reported with `reportError` and
does not break the loop.

`start` promises are tracked per transfer, so that `stop`, restart and
`destroy` reject exactly the pending one with `cancelled`.

### Choices recorded

- **`codec-init-failed`** replaces the working name `decoder-init-failed`
  from the design notes, because the sender loads wasm too.
- **cimbar file name.** It is always `qrcast.bin`, and does not carry
  `meta.n`:
  - cimbar's field holds 500 bytes, while meta allows 4096, so `meta.n`
    would need truncation.
  - The receiver never reads the field for qrcast payloads.
- **Limit.** `maxPayloadSize` is 16 MiB for all modes. The memory limit
  (about 23.5 MB on a fresh instance) binds before any mode's protocol
  limit.
- **Frame rate.** `fps` is accepted from 1 to 30. Out-of-range values are
  rejected rather than clamped, so mistakes are visible.

### Testing

- **Node (Vitest, existing setup).** Fake drivers cover:
  - options validation,
  - the error types,
  - the sender and receiver state machines,
  - detection and locking,
  - `acceptRaw`, and
  - emitter behavior.

  A vendor test checks the SHA-256 digests of the vendored files.
- **Browser** (Vitest browser mode with the Playwright provider and headless
  Chromium; a separate config, `pnpm test:browser`):
  - loopback transfers (sender canvas → `captureStream()` → receiver video),
  - automatic mode detection,
  - restart,
  - two 15 MiB starts back to back,
  - the bad `wasmUrl` failure,
  - the abort path, through a `workerFactory` that returns a fixture worker
    which aborts, and
  - typing while playing.
- `pnpm test` runs the type checks and the Node suite; `pnpm test:browser`
  runs the browser suite, which needs a Chromium download. The browser tests
  run the codec from `src/`, with a Vite middleware that serves the vendored
  files where `runtime.ts` expects them.
- Compatibility with the official cimbar web sender and receiver, and real
  phones, are checked by hand with `apps/demo`.

### Demo

`apps/demo` is a private Vite multi-page app with no styling:

- **Send page:** a file picker or a seeded random body (xorshift32, named
  `qrcast-random-<seed>-<size>.bin`), plus mode and fps controls.
- **Receive page:**
  - opens the rear camera with `getUserMedia`, and has an `acceptRaw` toggle;
  - shows progress, size, time from lock to completion and KB/s;
  - regenerates random bodies from the name to compare them byte for byte;
  - offers a download link.
- It depends on `qrcast: workspace:*`, sets `optimizeDeps.exclude` for
  `qrcast`, and uses `@vitejs/plugin-basic-ssl` so phones can open it over
  the LAN.

### Compatibility and device checks (task 9.2)

- **Phone receiving a desktop transfer (mode B), with the demo:** passed,
  checked by the owner. Speed, device and browser were not recorded.
- **Official cimbar web sender (cimbar.org) to the qrcast receiver with
  `acceptRaw`:** passed, checked by the owner; the file arrived as `raw`.
- **qrcast sender to the official libcimbar v0.6.8 web receiver:** passed,
  checked automatically. Frames recorded from the demo send page (a 30 KB
  seeded random body, mode B) were fed as a fake camera to the release's own
  `recv.html` in headless Chromium. It saved `qrcast.bin` (30803 bytes):
  the envelope, starting with `QRCAST`, version 1, flags 0, with the body
  intact.

## Risks / Trade-offs

- [Headless Chromium lacks WebGL in CI] → Launch it with SwiftShader flags
  in the browser test config. The spike confirmed it locally.
- [`captureStream()` and a `bitmaprenderer` canvas] → The spike confirmed
  that `captureStream()` captures it (1040 × 1040 BGRA frames), so the
  loopback tests capture the sender's canvas directly.
- [Vite dev pre-bundling rewrites `import.meta.url`, so assets 404] →
  `optimizeDeps.exclude: ['qrcast']`, documented in the README and used by
  the demo.
- [Bundlers treat a `.js` asset differently] → The demo verifies Vite; the
  `publish` change adds webpack and no-bundler smoke tests.
- [Package served cross-origin (ESM CDN): workers cannot start] →
  `codec-init-failed`; the README points to `workerFactory`.
- [Memory on phones: 1 + 3 receiver instances × 128 MB] → A conservative
  worker count; phone measurements are an open question below.
- [Recompiling 1.94 MB of wasm per transfer adds latency] → Expected to be
  tens of milliseconds with streaming compilation; measured in the demo.
  Caching a compiled `WebAssembly.Module` can come later.
- [Safari: OffscreenCanvas WebGL needs 17+, VideoFrame 16.4+] → Older
  versions get `unsupported-environment`. QR will be the fallback.

## Migration Plan

Additive and pre-1.0, with nothing to migrate.

## Open Questions

- Measured memory headroom and the best extract-worker count on phones (this
  only tunes N, not the specs).
