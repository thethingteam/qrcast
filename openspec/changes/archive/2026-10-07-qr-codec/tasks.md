# Tasks

## 1. Vendored files and package structure

- [x] 1.1 Vendor zxing-wasm 3.1.4 into `packages/qrcast/vendor/zxing-wasm/`:
  - Take `dist/iife/reader/index.js` (saved as `zxing_reader.js`),
    `dist/reader/zxing_reader.wasm` and `LICENSE` from the npm tarball.
  - Add the zxing-cpp Apache-2.0 license as `LICENSE.zxing-cpp`.
  - Add a README with the source, version, each file's sha256 and the update
    steps, following `vendor/cimbar/README.md`.
  - Verify: `sha256sum` matches the README.
- [x] 1.2 Add `zxing-wasm` 3.1.4 (exact) as a dev dependency, and a vendor test that compares the vendored script and wasm with the files in `node_modules/zxing-wasm` and with the README digests.
  - Verify: the test passes, and fails when a byte of the wasm is changed in
    a temporary copy.
- [x] 1.3 Extend `scripts/copy-assets.mjs` to copy `vendor/zxing-wasm/*` and `src/codecs/qr/qr-worker.js` to `dist/codecs/qr/`. Add `./qr` to `exports`, with a placeholder `src/codecs/qr/index.ts`.
  - Verify: `pnpm build` produces `dist/codecs/qr/` with the worker, the
    script, the wasm and both licenses.
  - Verify: `test/exports.test.ts` imports `qrcast/qr` from the built
    package in Node.

## 2. Wire format (pure, Node)

- [x] 2.1 Implement `base45.ts` and `crc32.ts`.
  - Verify: Node tests for the RFC 9285 vectors (`AB`, `Hello!!`,
    `base-45`), invalid lengths, characters and triplets, and CRC-32
    `123456789` → `CBF43926`.
- [x] 2.2 Implement `frame.ts` (format and parse `QRCAST1F` frames, split at the first six `/`).
  - Verify: Node tests for the "Frame text", "Frame fields" and "Invalid
    frames" scenarios in `specs/qr-frame-protocol`, including the reserved
    `QRCAST2F` and `QRCAST1X` prefixes, `TOTAL` 5001, a URL, and a payload
    that contains `/`.
- [x] 2.3 Implement `fountain.ts`: session ids (crypto, rejection sampling), source blocks with zero padding, mulberry32, the repair composition, the schedule and the encoder's payloads.
  - Verify: Node tests for the mulberry32 outputs `0x4434B462` and
    `0x00159C37`, the `K3Z9QA`/8/8 composition (seed `0xB18D40B8`, blocks
    0 1 5 6), `TOTAL` 1, the `TOTAL` 10 schedule over two passes, padding,
    and 1000 session ids that are all `[0-9A-Z]{6}`.
- [x] 2.4 Implement `decoder.ts` (the GF(2) decoder: bitset rows, Gauss-Jordan, cut to `LENGTH`).
  - Verify: Node tests for filling a gap with a repair frame, repair frames
    only, a repair frame with no new information, duplicates, and a
    4500-block, 800-byte transfer that drops 20 % of source frames and
    still rebuilds the data byte for byte.

## 3. Assembler (pure, Node)

- [x] 3.1 Implement `assembler.ts`:
  - parse texts and ignore invalid frames;
  - keep sessions keyed by `SESSION`, at most two, and evict the one that
    gained information least recently;
  - ignore frames that disagree with their session;
  - report the first valid frame, and progress as rank ÷ `TOTAL` for the
    most recently advanced session;
  - check the CRC-32 on completion, and reset the session on a mismatch.
  - Verify: Node tests for each case, including the "Half of the source
    frames" scenario (progress 0.5), a third session evicting the stalest
    one, a forged frame set with a wrong `CRC32` that resets and then
    completes with correct frames, and a restart from body A to body B that
    completes with B.

## 4. QR encoder and pictures (pure, Node)

- [x] 4.1 Add `qrcodegen.ts`, adapted from Project Nayuki's QR Code generator at a pinned release tag:
  - turn the namespace into ES exports and keep only the encoder;
  - keep the MIT header, and note the origin, the tag and the changes.
  - Verify: Node tests encode alphanumeric frame texts at level L with a
    forced version, and zxing-wasm (dev dependency) reads back the same
    text.
- [x] 4.2 Implement the version choice: the smallest version that holds a frame whose `INDEX` has 8 base36 digits.
  - Verify: a Node test shows that frames of the first and of a much later
    pass (5-digit repair indexes) encode at that version.
- [x] 4.3 Implement `picture.ts` (one or three layers → `ImageData`-shaped RGBA):
  - a white 4-module quiet zone;
  - `scale = max(1, floor(1024 / (size + 8)))`;
  - a dark module sets its channel to 0;
  - picture `k` takes frames `3k..3k+2` across passes.
  - Verify: Node tests for the "Channel values", "Pass not a multiple of
    three" and "Quiet zone" scenarios, the picture size, and zxing reading
    each channel of a composed color picture.

## 5. Shared worker helper

- [x] 5.1 Move the worker start protocol from `src/codecs/cimbar/runtime.ts` to `src/internal/worker.ts`, with the codec name as a parameter. It covers the factory or default worker, `init`, `ready` or failure, the 30 s timeout, `error`/`messageerror` before and after `ready`, and `terminate`. Make the cimbar runtime use it.
  - Verify: `pnpm test` and `pnpm test:browser` pass unchanged, including
    cimbar's bad `wasmUrl` and abort tests.

## 6. QR codec descriptor and sender

- [x] 6.1 Implement `qr(options)` in `index.ts` and `options.ts`:
  - name `qr`, `compress: true`, `maxPayloadSize = blockSize × 5000`;
  - the defaults 1 layer, 800-byte blocks and 15 fps;
  - option validation;
  - `sendFeatures: []` and `receiveFeatures: ['worker', 'webassembly', 'video-frame']`;
  - drivers loaded by dynamic import.
  - Verify: Node tests for the descriptor scenarios, each invalid option
    (`layers: 2`, `blockSize: 50`, `blockSize: 2001`, `fps: 0`, a
    non-function `workerFactory`), and that `qr()` loads nothing.
- [x] 6.2 Implement `sender-driver.ts`:
  - `start` creates the session, the blocks and the transfer's version;
  - `nextFrame` encodes the next `layers` frames from the schedule, fills
    the `ImageData` and returns `createImageBitmap`.
  - Verify: browser tests that a QR sender draws a first frame whose canvas
    size is square, at most 1024, and unchanged after two seconds; that it
    emits `frame` events at about 15 fps; that it starts with `WebAssembly`
    removed from `globalThis`; and that it requests no asset.

## 7. QR receiver

- [x] 7.1 Write `qr-worker.js` (classic, type-checked under `tsconfig.worker.json` with a `ZXingWASM` declaration):
  - `init`: `importScripts(glueUrl)`, then `prepareZXingModule` with a
    `locateFile` that returns `wasmUrl` and `fireImmediately`, then `ready`
    or the failure;
  - `decode`: OffscreenCanvas 2D pixels, the saturation check (central
    60 %, 64 × 64 samples, threshold 24), grayscale or per-channel
    `readBarcodes`, each channel in its own `try`, and deduplicated valid
    texts;
  - `onAbort` and uncaught errors post `aborted`.
  - Verify: `pnpm typecheck` passes.
- [x] 7.2 Implement `runtime.ts` (literal `new URL` references to the worker, `zxing_reader.js` and `zxing_reader.wasm`; override resolution) on top of the shared helper.
  - Add a Vite middleware to `vitest.browser.config.ts` that serves
    `vendor/zxing-wasm/` at `src/codecs/qr/`.
  - Verify: a browser test with a bad `wasmUrl` rejects with
    `codec-init-failed`, codec `qr`.
- [x] 7.3 Implement `receiver-driver.ts`:
  - `load` starts one decode worker;
  - `canAccept` allows at most 2 bitmaps in flight;
  - `push` crops the central square with `createImageBitmap`, closes the
    frame and transfers the bitmap;
  - texts go to the assembler, which drives `onData`, `onProgress` and
    `onFile(bytes, '')`;
  - aborts become `codec-aborted` with the last progress;
  - `dispose` terminates the worker.
  - Verify: browser loopback tests for a 20 KB random body in black and
    white and in color (byte for byte, `lock` `qr`, progress between 0 and
    1).
  - Verify: an abort fixture (via `workerFactory`) rejects with
    `codec-aborted`, codec `qr` and role `receiver`.
  - Verify: after completion, every worker the factory created has been
    terminated.
- [x] 7.4 Add browser tests for the receiver scenarios:
  - a canvas showing a QR code of `https://example.com/` (drawn with
    `qrcodegen`) does not lock a `[cimbar(), qr()]` receiver;
  - a sender restart from body A to body B resolves with B;
  - `[cimbar(), qr()]` locks to `qr` for a QR sender and to `cimbar` for a
    cimbar sender;
  - no resource entry points to another origin or to `cdn.jsdelivr.net`;
  - receiving without `WebAssembly` rejects with `unsupported-environment`.
  - Verify: `pnpm test:browser` passes.

## 8. Demo and docs

- [x] 8.1 Extend `apps/demo`:
  - The send page gets a codec choice: cimbar (mode, fps), or QR (layers,
    block size, fps).
  - The receive page uses `[cimbar(), qr()]` and shows the locked codec.
  - Verify: `pnpm --filter demo build` succeeds, and the output contains
    the QR worker, `zxing_reader.js` and `zxing_reader.wasm`.
- [x] 8.2 Update the README:
  - the codec table marks QR as available;
  - a `qr` section covers options, defaults, limits, the 5000-block cap,
    asset sizes, and the fact that sending fetches nothing;
  - a tip to scale the canvas with `image-rendering: pixelated`;
  - receiving with `[cimbar(), qr()]`;
  - the zxing licenses.
  - Verify: the README examples type-check against the built package.
- [x] 8.3 Manual check on real devices with the demo (phone receiving checked; the reverse direction and speeds are deferred, see design.md):
  - a phone receives a desktop QR transfer in black and white and in color;
  - a desktop receives from a phone.
  - Record speed, device and browser in design.md.

## 9. Integration

- [x] 9.1 Run a clean `pnpm install && pnpm build && pnpm test && pnpm test:browser && pnpm --filter demo build` and `openspec validate qr-codec --strict`.
  - Verify: all pass.
- [x] 9.2 Trim `docs/design-notes.md`:
  - Sections 5.2 and 6 point to the `qr-frame-protocol` and `qr-codec`
    specs and to the archived design.
  - Remove the QR parts of sections 8, 10 and 11 that are now in the
    specs.
  - Section 15 marks `qr-codec` as done.
  - Verify: no decision in the notes contradicts the specs.
