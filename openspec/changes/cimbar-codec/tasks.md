# Tasks

## 1. Spike: cimbar encoder in a worker (gate)

- [x] 1.1 Vendor the libcimbar v0.6.8 files into `packages/qrcast/vendor/cimbar/`:
  - Take the glue script, the wasm and the repo `LICENSE` from the official
    release `cimbar.wasm.tar.gz` (sha256
    `0a14b63decd9404e7a319b4b0f5cd873eb6aa325f90df4e965305f523567c4a5`).
  - Add a README with the source, the version and each file's sha256.
  - Verify: `sha256sum` matches the README.
- [x] 1.2 Add Vitest browser mode (Playwright provider, headless Chromium,
  separate `vitest.browser.config.ts` and a `test:browser` script).
  - Verify: a trivial browser test passes, and confirms that WebGL2 is
    available on an `OffscreenCanvas` inside a worker (add SwiftShader
    launch flags if needed).
- [x] 1.3 Write a throwaway classic worker that loads the glue with `locateFile`, minimal `window`/`document` stand-ins and an `OffscreenCanvas` as `Module.canvas`, encodes 200 KB, and posts 30 frames as `ImageBitmap`s.
  - Verify in a browser test: the frames arrive, are non-blank and differ
    from each other.
  - If GLFW cannot run in the worker, stop and report to the owner (see
    design.md) before any further task.
- [x] 1.4 Extend the spike with a decode check: the bitmaps go through an RGBA copy to a second worker (`cimbard_scan_extract_decode`), then to a third (`cimbard_fountain_decode` and `cimbard_decompress_read`).
  - Verify: the bytes come back identical.
  - Record any finding (stand-ins needed, `captureStream()` on a
    `bitmaprenderer` canvas) in design.md, then delete the spike code.

## 2. Package structure and assets

- [x] 2.1 Add `scripts/copy-assets.mjs` and run it after `tsc` in `build`. It copies the vendored files and `cimbar-worker.js` to `dist/codecs/cimbar/`.
  - Verify: `pnpm build` produces `dist/codecs/cimbar/` with the glue, the
    wasm, `LICENSE` and the worker.
- [x] 2.2 Add the `./sender`, `./receiver` and `./cimbar` entries to `exports`, with placeholder modules.
  - Verify: extend `test/exports.test.ts` so that importing each subpath
    from the built package succeeds in Node (safe-import requirements).
- [x] 2.3 Add a Node test that recomputes the SHA-256 of the vendored glue and wasm and compares them with the release digests.
  - Verify: the test passes, and fails when a byte of the wasm is changed in
    a temporary copy.

## 3. Error model

- [x] 3.1 Extend `ErrorDetails` in `src/errors.ts`:
  - Add `unsupported-environment` `{ feature }`, `codec-init-failed`
    `{ codec }`, `codec-aborted` (a union by `role` with `size` or
    `progress`), `cancelled` `{ reason }` and `invalid-state` `{ state }`.
  - Add the `option` reason to `invalid-input`.
  - Export the new types.
  - Verify: `test/errors.test.ts` covers each code, and a type test checks
    narrowing for `codec-aborted` by `role`.

## 4. Shared internals

- [x] 4.1 Implement the typed emitter in `src/internal/` (`on` returns an unsubscribe function; a throwing listener goes to `reportError` and does not stop delivery).
  - Verify: Node tests for unsubscribe and a throwing listener.
- [x] 4.2 Define the internal codec driver types, the module-private codec symbol and `isQrcastCodec()`.
  - Verify: a Node test rejects a plain descriptor object.
- [x] 4.3 Implement the environment probes (`worker`, `webassembly`, `webgl` via `OffscreenCanvas`, `video-frame`), returning the first missing feature.
  - Verify: Node tests with stubbed globals cover each feature.

## 5. cimbar codec descriptor

- [x] 5.1 Implement `cimbar(options)` in `src/codecs/cimbar/index.ts`:
  - Validate `mode`, `fps`, `glueUrl`, `wasmUrl` and `workerFactory`.
  - Return the frozen descriptor (name `cimbar`, `maxPayloadSize` 16777216,
    `compress` false) with the role factories, which dynamically import the
    runtime.
  - Verify with Node tests: the cimbar-codec descriptor and options
    scenarios, and importing `qrcast/cimbar` and calling `cimbar()` requests
    no asset (the runtime module is not loaded).

## 6. cimbar worker and runtime

- [x] 6.1 Write `src/codecs/cimbar/cimbar-worker.js` (classic, `checkJs`, with a `.d.ts` for the cimbar `Module`):
  - The init message selects the role (`encode`, `extract` or `assemble`)
    and carries the glue and wasm URLs.
  - It posts `ready`, `aborted` and `init-failed`, with an `onAbort` hook
    and try/catch around every cimbar call.
  - Implement the encode role from the spike: configure, init_window,
    init_encode with `qrcast.bin`, chunked encode, then render a frame on
    request and post it as an `ImageBitmap`.
  - Implement the extract role: configure_decode per message, mode rotation
    when no mode is fixed, scan_extract_decode, and return the bytes and the
    mode.
  - Implement the assemble role: fountain_decode, progress from the report,
    and on completion the file name plus the chunked decompress_read.
  - Verify: `pnpm typecheck` covers the worker.
- [x] 6.2 Implement `runtime.ts`: the literal `new URL` asset references, worker creation (default or `workerFactory`), init with a 30 s timeout, and mapping of worker failures to `codec-init-failed` and `codec-aborted`.
  - Verify with browser tests: a bad `wasmUrl` yields `codec-init-failed`
    with codec `cimbar`, and a fixture worker that posts `aborted` yields
    `codec-aborted`.

## 7. Sender

- [x] 7.1 Implement `createSender` in `src/sender/`:
  - Option checks: the canvas and its `bitmaprenderer` context, and the
    codec brand.
  - The state machine (`idle`, `loading`, `playing`, `destroyed`) and the
    `state`, `frame` and `error` events.
  - `start`: environment probe, then `prepareTransfer`, then driver load,
    with per-transfer promise tracking for `cancelled`. Also `stop` and
    `destroy`.
  - The rAF pacing with a 2 ms tolerance.
  - Verify with Node tests, using a fake driver and a fake rAF: every sender
    spec scenario that does not need a real codec, including the size check
    loading nothing and restart cancelling.
- [x] 7.2 Implement the cimbar sender driver (encoder worker client with one frame rendered ahead).
  - Verify with browser tests:
    - the first frame sets the canvas size and leaves `style` unchanged;
    - about 15 frames per second by default;
    - two 15 MiB starts back to back both resolve;
    - Backspace and Tab still work in an input while playing;
    - an abort emits `error` with role `sender` and the envelope size.
- [x] 7.3 Add the sender section to the README (usage, the canvas, events, errors).
  - Verify: the README's sender example type-checks when pasted into a
    scratch file against the built package.

## 8. Receiver

- [x] 8.1 Implement `createReceiver` in `src/receiver/`:
  - Option checks, plus the state machine (`idle`, `loading`, `detecting`,
    `receiving`, `destroyed`) and the `state`, `lock` and `progress` events.
  - Frame capture through `requestVideoFrameCallback` (with an rAF
    fallback) into a `VideoFrame`.
  - Detection and locking across drivers.
  - Envelope unwrapping and `acceptRaw` results, plus `preload`, `stop` and
    `destroy`.
  - Verify with Node tests, using fake drivers and a fake frame source:
    detection with two codecs, raw with and without `acceptRaw`, envelope
    errors, `invalid-state` and `cancelled`, and that the video element is
    never modified.
- [x] 8.2 Implement the cimbar receiver driver:
  - The extract pool (N = clamp(hardwareConcurrency - 1, 1, 3), at most 2 in
    flight per worker).
  - The NV12/I420/RGBA copy, the assembler forwarding, and progress and
    completion.
  - Verify with browser tests:
    - a 200 KB loopback transfer is byte-identical, with `lock` and
      `progress` events;
    - a sender in mode 4C is received by an automatic receiver;
    - a fixed-mode mismatch never locks within 10 s;
    - two transfers in a row both succeed;
    - an abort rejects with role `receiver`.
- [x] 8.3 Add the receiver section to the README (usage, camera ownership, `acceptRaw`, results, errors).
  - Verify: the example type-checks against the built package.

## 9. Demo app

- [x] 9.1 Create `apps/demo` (private, Vite, multi-page):
  - Use `qrcast: workspace:*`, `optimizeDeps.exclude: ['qrcast']` and
    `@vitejs/plugin-basic-ssl`.
  - Add the send page (file or seeded random body, mode, fps) and the
    receive page (rear camera, `acceptRaw` toggle, progress, KB/s, random
    body verification, download link).
  - Verify: `pnpm --filter demo build` succeeds, and the output contains the
    cimbar wasm, the glue and the worker.
- [x] 9.2 Manual check on real devices with the demo:
  - A phone receives a desktop transfer in mode B.
  - The official cimbar web receiver saves `qrcast.bin` containing the
    envelope.
  - The official cimbar web sender's file arrives as `raw` with its name.
  - Record the results (speed, device, browser) in design.md.

## 10. Integration and docs

- [x] 10.1 Update the README:
  - Status.
  - The Offline / PWA section: the Vite `optimizeDeps.exclude`, and for
    vite-plugin-pwa the `wasm` glob and `maximumFileSizeToCacheInBytes`.
  - The CSP `'wasm-unsafe-eval'` note.
  - The supported browsers.
  - Verify: the README's commands and config snippets match the demo's
    working config.
- [x] 10.2 Run a clean `pnpm install && pnpm build && pnpm test && pnpm test:browser && pnpm --filter demo build`, and `openspec validate cimbar-codec --strict`.
  - Verify: all pass.
